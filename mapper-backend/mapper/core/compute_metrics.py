# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tiny helper for estimating the carbon footprint of a computation.

Wrap an expensive block in ``measure_compute()`` and call ``.build()`` to get
a :class:`ComputeMetrics` object for attachment to a compute-endpoint response.

The numbers are rough — wall time * estimated TDP / 3600 * grid intensity —
but they give the user a proportional sense of what each computation costs.
The frontend recomputes energy/CO₂ using the user's own TDP + country
settings; the values emitted here are server-side defaults.
"""
from __future__ import annotations

import platform
import time
from dataclasses import dataclass

from pydantic import BaseModel


# World-average grid carbon intensity used as the server-side default.
# The frontend overrides with the user's selected country.
_DEFAULT_GRID_INTENSITY_G_PER_KWH = 440.0


def default_tdp_watts() -> float:
    """Return a coarse default TDP based on CPU architecture.

    Apple Silicon (arm64 on Darwin) is meaningfully more efficient than
    typical x86 laptop/desktop silicon, so give it its own bucket.
    """
    machine = (platform.machine() or "").lower()
    system = (platform.system() or "").lower()
    if system == "darwin" and machine in ("arm64", "aarch64"):
        return 15.0
    if machine in ("aarch64", "arm64"):
        return 15.0
    # Crude desktop-vs-laptop split — no portable way to tell, so we default
    # to laptop. Users can override in Settings.
    return 28.0


class ComputeMetrics(BaseModel):
    wall_time_seconds: float
    cpu_time_seconds: float
    estimated_energy_wh: float
    estimated_co2_g: float
    tdp_watts: float
    grid_intensity_g_per_kwh: float


@dataclass
class _MeasureHandle:
    _wall_start: float
    _cpu_start: float
    tdp_watts: float
    grid_intensity_g_per_kwh: float

    def build(self) -> ComputeMetrics:
        wall = max(0.0, time.time() - self._wall_start)
        cpu = max(0.0, time.process_time() - self._cpu_start)
        # Energy: Wh = watts * hours. Prefer CPU time (excludes I/O idle) but
        # fall back to wall time when process_time is suspiciously low (e.g.
        # on macOS with child processes).
        active = cpu if cpu > 0.01 else wall
        energy_wh = self.tdp_watts * (active / 3600.0)
        co2_g = energy_wh * (self.grid_intensity_g_per_kwh / 1000.0)
        return ComputeMetrics(
            wall_time_seconds=round(wall, 4),
            cpu_time_seconds=round(cpu, 4),
            estimated_energy_wh=round(energy_wh, 6),
            estimated_co2_g=round(co2_g, 6),
            tdp_watts=self.tdp_watts,
            grid_intensity_g_per_kwh=self.grid_intensity_g_per_kwh,
        )


def measure_compute(
    tdp_watts: float | None = None,
    grid_intensity_g_per_kwh: float | None = None,
) -> _MeasureHandle:
    """Start measuring. Call ``.build()`` at the end to materialize the metrics.

    Intentionally not a context manager — endpoints need to keep the handle
    in scope past any early-return branches.
    """
    return _MeasureHandle(
        _wall_start=time.time(),
        _cpu_start=time.process_time(),
        tdp_watts=tdp_watts if tdp_watts is not None else default_tdp_watts(),
        grid_intensity_g_per_kwh=(
            grid_intensity_g_per_kwh
            if grid_intensity_g_per_kwh is not None
            else _DEFAULT_GRID_INTENSITY_G_PER_KWH
        ),
    )

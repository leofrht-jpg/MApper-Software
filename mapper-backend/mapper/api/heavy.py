# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Run a long, synchronous compute route without freezing the event loop.

A route declared ``async def`` that never ``await``s runs on the event loop, so
a 20-second LCA stops every other request in the app for 20 seconds -- the Log
panel, the project list, the progress sockets. The routes in
``HEAVY_ROUTES`` (``tests/test_heavy_routes_offloaded.py``) keep their
``async def`` signature, so ``await route(body)`` from another route and
``asyncio.run(route(body))`` from a test still work, and hand their body to the
threadpool through :func:`run_heavy`.

**One at a time.** On the loop these routes were serialised by accident: a
second request waited for the first. Run in threads they would overlap, doubling
memory and racing on the module-level caches. ``compute_lock`` keeps the old
one-at-a-time behaviour among themselves, while light requests now get through.
The lock is re-entrant so a heavy function that calls another heavy function
directly on the same thread does not deadlock.

What this does NOT serialise: a light request that changes shared state (switch
project, edit a table) can now run while a heavy route is in flight, where it
used to wait. The UI blocks input while a compute runs and every request
carries the project guard header, which is checked when the request starts.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, TypeVar

from starlette.concurrency import run_in_threadpool

T = TypeVar("T")

#: Held for the whole of one heavy route. Re-entrant.
compute_lock = threading.RLock()


def _locked(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    with compute_lock:
        return fn(*args, **kwargs)


async def run_heavy(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """``fn(*args, **kwargs)`` on a worker thread, one heavy route at a time."""
    return await run_in_threadpool(_locked, fn, *args, **kwargs)

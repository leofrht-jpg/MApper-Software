# SPDX-License-Identifier: MPL-2.0
"""Settings › Logs is not flooded by bw2calc's per-call INFO lines, and its
warnings and errors still arrive.

Through the real logger bw2calc uses, with a handler on root standing in for
the rotating file handler (same propagation path).
"""
from __future__ import annotations

import logging


def test_bw2calc_info_is_dropped_but_warnings_reach_the_log():
    from mapper.core.log_config import quiet_chatty_libraries

    quiet_chatty_libraries()
    seen: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record):
            seen.append(record)

    h = Capture(level=logging.INFO)
    root = logging.getLogger()
    old = root.level
    root.addHandler(h)
    root.setLevel(logging.INFO)
    try:
        lg = logging.getLogger("bw2calc")          # what bw2calc.lca uses
        lg.info("Switching LCIA method")
        lg.info("Redoing LCIA")
        lg.warning("a real warning")
        lg.error("a real error")
        logging.getLogger("mapper.api.lca").info("mapper's own INFO is untouched")
    finally:
        root.removeHandler(h)
        root.setLevel(old)
    msgs = [r.getMessage() for r in seen]
    assert "Switching LCIA method" not in msgs and "Redoing LCIA" not in msgs
    assert "a real warning" in msgs and "a real error" in msgs
    assert "mapper's own INFO is untouched" in msgs


def test_bw2calc_still_logs_through_the_name_we_quiet():
    import inspect

    import bw2calc.lca as lca
    assert "getLogger('bw2calc')" in inspect.getsource(lca) or 'getLogger("bw2calc")' in inspect.getsource(lca)

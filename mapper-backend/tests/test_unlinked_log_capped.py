# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""premise's root ``unlinked.log`` handler is capped at WARNING, root at INFO.

premise calls ``logging.basicConfig(level=DEBUG, filename="unlinked.log")``
at import; because premise is imported before MApper configures logging, every
library's debug output went into that file (1.7 GB on one machine).
"""
from __future__ import annotations

import logging

import pytest

from mapper.core import log_config


@pytest.fixture
def root_with_unlinked(tmp_path):
    root = logging.getLogger()
    saved_level, saved_handlers = root.level, list(root.handlers)
    path = tmp_path / "unlinked.log"
    path.write_text("existing line\n")
    handler = logging.FileHandler(path, mode="a")  # level NOTSET, as basicConfig leaves it
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    yield root, handler, path
    root.removeHandler(handler)
    handler.close()
    root.setLevel(saved_level)
    root.handlers[:] = saved_handlers


def test_caps_the_handler_and_the_root(root_with_unlinked):
    root, handler, _ = root_with_unlinked
    capped = log_config.cap_premise_unlinked_log()
    assert capped == [handler]
    assert handler.level == logging.WARNING
    assert root.level == logging.INFO


def test_debug_stops_reaching_the_file_and_warnings_still_do(root_with_unlinked):
    _, handler, path = root_with_unlinked
    log_config.cap_premise_unlinked_log()
    lib = logging.getLogger("some.library")
    lib.debug("debug chatter")
    lib.info("info chatter")
    lib.warning("an unlinked flow")
    handler.flush()
    text = path.read_text()
    assert "debug chatter" not in text and "info chatter" not in text
    assert "an unlinked flow" in text


def test_the_existing_file_is_neither_deleted_nor_truncated(root_with_unlinked):
    _, _, path = root_with_unlinked
    log_config.cap_premise_unlinked_log()
    assert path.read_text().startswith("existing line\n")


def test_other_file_handlers_are_left_alone(tmp_path, root_with_unlinked):
    root, _, _ = root_with_unlinked
    other = logging.FileHandler(tmp_path / "something_else.log", delay=True)
    root.addHandler(other)
    try:
        log_config.cap_premise_unlinked_log()
        assert other.level == logging.NOTSET
    finally:
        root.removeHandler(other)
        other.close()


def test_configure_logging_applies_the_cap(root_with_unlinked):
    _, handler, _ = root_with_unlinked
    log_config.configure_logging()  # already configured: still caps on every call
    assert handler.level == logging.WARNING

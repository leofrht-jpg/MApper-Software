# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""``index.html`` must revalidate. Hashed assets must stay cacheable.

The desktop webview loads the SPA over http from the backend. Starlette's
``StaticFiles`` sends ``etag`` + ``last-modified`` but no ``Cache-Control``,
which leaves the webview free to apply HEURISTIC freshness and reuse a stored
``index.html`` without asking. That is the whole stale-SPA failure: Vite
content-hashes the assets, so a new build changes their URLs, and a stale
``index.html`` points at hashes the new bundle does not contain -- every one
404s and the app comes up blank.

The fix is scoped deliberately narrowly. ``index.html`` is the ONLY file whose
name is not content-addressed, so it is the only one that can go stale; the
hashed bundles are exactly what an HTTP cache is for and must keep their
default cacheability. A blanket no-cache would make every launch re-download
megabytes of unchanged JavaScript.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from desktop_entry import _SPAStaticFiles

# One asset name per shape Vite actually emits, so "index" appearing inside a
# hashed filename cannot be mistaken for the entry document.
HASHED_ASSETS = {
    "assets/index-vbhBHsde.js": "console.log(1)",
    "assets/index-CxtAfB3Y.css": "body{color:red}",
    "assets/html2canvas-CyJ9IaF-.js": "console.log(2)",
    "assets/purify.es-B0oQ7434.js": "console.log(3)",
}


@pytest.fixture
def spa(tmp_path):
    """A minimal built SPA, mounted the same way desktop_entry mounts it."""
    (tmp_path / "index.html").write_text(
        '<!doctype html><script src="/assets/index-vbhBHsde.js"></script>'
    )
    (tmp_path / "assets").mkdir()
    for rel, body in HASHED_ASSETS.items():
        (tmp_path / rel).write_text(body)
    # A decoy: a non-hashed html file that is NOT the entry document.
    (tmp_path / "other.html").write_text("<p>not the entry</p>")

    app = FastAPI()
    app.mount("/", _SPAStaticFiles(directory=str(tmp_path), html=True), name="frontend")
    return TestClient(app)


def test_index_html_is_no_cache(spa):
    r = spa.get("/index.html")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-cache"


@pytest.mark.parametrize("path", sorted(HASHED_ASSETS))
def test_hashed_assets_stay_cacheable(spa, path):
    """The narrow scope IS the feature.

    Hashed bundles are content-addressed: a new build gives them a new URL, so a
    cached copy can never be served in place of a new one. Sending no-cache here
    would re-download the whole bundle on every launch to no benefit.
    """
    r = spa.get("/" + path)
    assert r.status_code == 200
    assert "cache-control" not in {k.lower() for k in r.headers}


def test_only_index_html_is_special_not_every_html_file(spa):
    """A file merely ending in .html is not the entry document."""
    r = spa.get("/other.html")
    assert r.status_code == 200
    assert "cache-control" not in {k.lower() for k in r.headers}


def test_html_fallback_also_revalidates(spa):
    """``html=True`` serves index.html for a directory request.

    The header is keyed on the file actually served, not on the request path, so
    the fallback route gets it too -- a path-based check would have missed this.
    """
    r = spa.get("/")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-cache"


def test_revalidation_is_cheap_not_a_redownload(spa):
    """no-cache, NOT no-store.

    The response may still be STORED; it may just not be reused without asking.
    Starlette already sends an etag, so the steady state is a 304 with no body --
    one conditional request per launch, not a re-fetch of the document.
    """
    first = spa.get("/index.html")
    etag = first.headers.get("etag")
    assert etag, "etag is what makes no-cache cheap; without it this is a re-download"

    second = spa.get("/index.html", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert not second.content

    # no-store would forbid storing the response at all, which is not what we want
    assert "no-store" not in first.headers.get("cache-control", "")


def test_a_changed_index_is_served_not_the_stale_one(tmp_path):
    """The actual bug, end to end.

    A new build rewrites index.html to point at a new asset hash and removes the
    old asset. If the entry document were reused from cache, it would reference a
    file that no longer exists. Here the conditional request must MISS, because
    the etag changed with the content.
    """
    (tmp_path / "index.html").write_text('<script src="/assets/index-OLD.js"></script>')
    app = FastAPI()
    app.mount("/", _SPAStaticFiles(directory=str(tmp_path), html=True), name="frontend")
    client = TestClient(app)

    old = client.get("/index.html")
    old_etag = old.headers["etag"]
    assert "index-OLD.js" in old.text

    # ...a new build lands
    (tmp_path / "index.html").write_text('<script src="/assets/index-NEW.js"></script>')

    revalidated = client.get("/index.html", headers={"If-None-Match": old_etag})
    assert revalidated.status_code == 200, "a changed index must not answer 304"
    assert "index-NEW.js" in revalidated.text
    assert revalidated.headers.get("cache-control") == "no-cache"

"""No em dash in a string the USER reads.

The sweep that removed them was manual and walked the TS and Python sources.
It missed two, both in the Tauri crate, and one of those was invisible to any
plausible grep:

  1. The splash message, inside a BASE64-ENCODED data: URL in a Rust string
     constant. Not in a .ts, not in a .py, not in any .html, and not findable
     by grepping .rs for the character -- it is base64.
  2. The failure-dialog title, a plain Rust literal, which a .rs grep WOULD
     have found had .rs been in scope.

So the gap was scope (Rust was never walked) plus encoding (base64 hides the
character even within scope). This walks the crate and decodes the data URL.
"""
from __future__ import annotations

import base64
import pathlib
import re

CRATE = pathlib.Path(__file__).resolve().parents[2] / "mapper-tauri" / "src"
EM_DASH = "—"


def _rust_sources():
    return sorted(CRATE.glob("*.rs"))


def test_the_crate_exists_so_this_is_not_vacuous():
    files = _rust_sources()
    assert files, f"no Rust sources under {CRATE}"
    assert any(f.name == "main.rs" for f in files)


def test_no_em_dash_in_a_user_facing_rust_literal():
    """Comments may contain them -- users never read a comment."""
    bad: list[str] = []
    for f in _rust_sources():
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith("//"):
                continue
            if EM_DASH in line and '"' in line:
                bad.append(f"{f.name}:{i}: {stripped[:90]}")
    assert not bad, (
        "em dash in a user-facing Rust string:\n  " + "\n  ".join(bad)
    )


def test_no_em_dash_inside_the_base64_splash_page():
    """The one a grep cannot see.

    The loading page is an inline base64 data: URL, so the character does not
    appear anywhere in the file even though the user reads it on every cold
    start.
    """
    src = (CRATE / "main.rs").read_text(encoding="utf-8")
    urls = re.findall(r'"data:text/html;base64,([A-Za-z0-9+/=]+)"', src)
    assert urls, "the inline splash data URL is gone -- was it moved to a file?"
    for b64 in urls:
        html = base64.b64decode(b64).decode("utf-8")
        assert EM_DASH not in html, (
            "em dash in the base64 splash page. Decode it, fix the text, "
            "re-encode. Decoded text was:\n" + html[-400:]
        )


def test_the_decoder_would_catch_a_reintroduced_one():
    """Anti-vacuity: prove the check fires on the shape that shipped."""
    html = "<div class='sub'>Preparing the backend — this takes a while.</div>"
    b64 = base64.b64encode(html.encode()).decode()
    assert EM_DASH in base64.b64decode(b64).decode()

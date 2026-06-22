# Public Release Checklist — MApper

Manual steps to take MApper public. **Do not flip the repository public until the
DTU prerequisites below are cleared.** This list complements the automated
licensing pass (LICENSE, NOTICE, headers, third-party inventory) already applied
to the tree.

License: **Mozilla Public License 2.0 (MPL-2.0)**. Copyright holder: **Technical
University of Denmark**. Lead developer: **Leonardo Ferhati**.

---

## 1. DTU prerequisites (FIRST — do these before anything public)

- [ ] **Department management approval.** Confirm DTU department management has
      approved releasing MApper as open source.
- [ ] **Follow DTU's software-publishing procedure** (see inside.dtu.dk) for
      releasing research software.
- [ ] **Communicate the chosen license (MPL 2.0)** to **Michelle / Legal & Tech
      Transfer** and confirm there is no objection.
- [ ] **Contributor IP / CLA-DCO instrument** confirmed with DTU's Technology
      Transfer Office (**Kamilla, TTO jurist**) *before* accepting any external
      pull request. See `CONTRIBUTING.md`.
- [ ] **Commercial services are GATED.** No commercial advertising or activity
      (training, certification, consulting, custom development, support
      contracts, hosted SaaS, commercial extensions) until a **secondary-
      employment arrangement is in place via Frida (dept. innovation)**. The
      paid-services menu in `README.md` / the website must stay inside its
      DRAFT block until then. Only the license fact (free incl. commercial) is
      published.

## 2. Repository content / safety

- [ ] **Final secret re-scan** immediately before flipping public (`.env*`, API
      keys, tokens, `ADMIN_SECRET`, Supabase keys / service-role, premise key,
      `waitlist.json`). Nothing secret in tracked or about-to-be-tracked files.
- [ ] Confirm `.env*`, `C4MApper/`, `_reference/`, `premise_key`, `waitlist.json`,
      `*.7z` (ecoinvent) are git-ignored. `C4MApper/` (private context notes)
      lives outside the repo tree — confirm it is not added.
- [ ] `python scripts/check_license_headers.py` → 100% coverage.
- [ ] `LICENSE` byte-matches canonical MPL 2.0.
- [ ] Every first-party dependency appears in `THIRD_PARTY_LICENSES.md`.

## 3. GitHub configuration

- [ ] **Make the repository public** (`github.com/leofrht-jpg/MApper-Software`).
- [ ] Set the **description** and **topics**: `LCA`, `prospective-LCA`, `DSM`,
      `MFA`, `AESA`, `sustainability`, `brightway2`, `premise`.
- [ ] **Enable Issues and Discussions.**
- [ ] **Verify license auto-detection** shows "MPL-2.0" in the repo sidebar.
- [ ] **Branch protection on `main`** (require PR review + passing CI; no direct
      pushes).
- [ ] **GitHub Actions CI** on pull requests:
      - frontend — `npm run type-check` (tsc) + `npm run test:run` (vitest)
      - backend — `pytest` (conda env `map`)
- [ ] **`SECURITY.md`** present for vulnerability reporting (done — verify the
      contact is current).
- [ ] **Enable Dependabot** (security + version updates).
- [ ] *(Optional)* enable **GitHub Sponsors**.

## 4. Documentation sanity

- [ ] `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
      `LICENSE`, `NOTICE`, `COPYRIGHT`, `THIRD_PARTY_LICENSES.md` render on GitHub
      and all internal links resolve.
- [ ] Citation block in `README.md` updated with the JOSS DOI once published.

---

**Reminder:** website work (footer notice, `/license`, `/cite`, `/commercial`
gated) is tracked separately and must mirror the same license fact + commercial
gating.

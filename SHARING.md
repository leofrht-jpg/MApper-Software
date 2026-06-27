# MApper — Desktop App (install & setup)

This is a first desktop build of **MApper** for **macOS on Apple Silicon**
(M1/M2/M3/M4). It bundles the React UI + the Python/Brightway2 backend into one
app — no conda, no terminal needed to run it.

> **ecoinvent is NOT included.** MApper needs an ecoinvent-licensed Brightway2
> project, which you set up yourself from inside the app (see step 3). ecoinvent
> is separately licensed — MApper neither bundles nor distributes it.

---

## 1. Install

1. Open `MApper_0.1.0_aarch64.dmg` (or the `MApper.app`).
2. Drag **MApper** into **Applications**.

## 2. First launch — Gatekeeper bypass (this build is UNSIGNED)

Because this build is not yet code-signed or notarized, macOS Gatekeeper will
block a normal double-click ("MApper is damaged / can't be opened / from an
unidentified developer"). This is expected for a trusted local build. To open:

- **Right-click (or Control-click) `MApper.app` → Open → Open** in the dialog.

  You only need to do this once; afterwards it opens normally.

- If macOS still refuses (Sequoia/Tahoe are stricter), run once in Terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/MApper.app
  ```

  then open it normally.

On first launch the app shows nothing for **up to ~2 minutes** while the
embedded backend unpacks and (on the very first run only) builds a font cache —
this is normal. Later launches are faster. The window appears once the backend
is ready. (If it ever times out, you'll get a clear "backend not responding"
dialog — quit and reopen.)

## 3. Set up ecoinvent (required for LCA) — you do this once

MApper looks for a Brightway2 project on disk at:

```
~/Library/Application Support/Brightway3
```

You don't create that by hand — MApper manages it. To populate it with
ecoinvent:

1. Open MApper → go to the **Database Explorer** tab.
2. Either:
   - **Import via your ecoinvent account** — enter your ecoinvent username +
     password, pick a version (e.g. 3.10) and system model (cutoff), and import.
     *(You must have your own ecoinvent licence.)*
   - **or Import a local `.7z`** — point MApper at an ecoinvent `.7z` release
     file you already downloaded.
3. The import runs in the background (can take ~10 minutes). When it finishes,
   the database appears in the Database Explorer.

Until a database is imported, **UI-only features still work** (AESA
configuration, sharing/boundary setup, parameters). LCA/Impact tabs will tell
you to import a database first instead of crashing.

### Optional — premise (prospective LCA)

Prospective LCA needs a premise encryption key (separate from ecoinvent):

```bash
mkdir -p ~/.premise
echo 'YOUR_KEY' > ~/.premise/premise_key
```

Request a key from `romain.sacchi@psi.ch`. Without it, the rest of MApper still
works; only the pLCA Developer tab needs it.

## 4. Using it

Once a database is imported you can build archetypes (Bills of Materials), run
Impact Assessment, Dynamic Stock Modelling, and AESA. Your projects, archetypes,
and configs persist between launches.

---

## Troubleshooting

- **"Backend not responding" on launch** — quit fully (Cmd-Q) and reopen; the
  first start is slow. If it persists, you may have something else already using
  port **8765** on your machine.
- **LCA fails with a database/project error** — confirm you imported ecoinvent
  in the Database Explorer (step 3) and that it's selected.
- **App won't open at all** — redo the Gatekeeper bypass (step 2).

## What this build is / isn't

- ✅ macOS Apple Silicon, self-contained UI + backend, in-app ecoinvent import.
- ❌ Not signed/notarized (hence the Gatekeeper step), macOS-Intel/Windows not
  built, no auto-update. See `DESKTOP.md` for the deferred list.

Questions: **leo_frht@icloud.com**.

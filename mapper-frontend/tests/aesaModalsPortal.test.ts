// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

// Every fixed-position overlay rendered inside the AESA configuration sidebar
// must portal to document.body.
//
// The sidebar is `<aside style={{ position: 'sticky', top: 0 }}>` (Patch 4V).
// `position: sticky` creates a stacking context REGARDLESS of z-index, so a
// `position: fixed` overlay inside it cannot escape: positioned content in the
// sibling `<main>` paints in the same phase and wins on DOM order, so the
// overlay can be visible while its buttons are unreachable.
//
// THE FAILURE IS INTERMITTENT, AND THAT IS THE TRAP. Whether a click lands
// depends on what `<main>` happens to be rendering underneath the modal. With
// no AESA result on screen there is little positioned content and the dialog is
// clickable; with a radar chart rendered, the chart's containers paint over it
// and the buttons go dead. Confirmed by screenshot: the radar's spokes and axis
// labels draw visibly THROUGH the dialog panel, and chart content paints over
// the "Replace configuration" button. It reads as translucency and is not --
// it is paint order.
//
// So the same click works, then does not, on the same screen. Anyone meeting
// this for the first time will reasonably conclude it is a flake and chase the
// handler. It is not a flake and it is not the handler: it is this rule, and
// this test is the cheap way to find that out.
//
// Patch 4X fixed exactly this for the session modals and wrote the explanation
// into a comment beside them. THE COMMENT DID NOT PROPAGATE: three components
// added afterwards — ConfigWorkbookButtons, LayerEditModal, PrinciplesEditor —
// each hand-rolled the same un-portalled overlay. Four siblings portalled,
// three did not.
//
// So this is a test rather than a comment, and a test rather than a shared
// <Modal> wrapper: a wrapper only portals what goes through it, and nothing
// stops the next person writing `<div style={{ position: 'fixed' }}>` by hand,
// which is precisely how these three arose. The invariant is enforced on the
// SOURCE, so it holds however the overlay is implemented.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { relPosix } from './helpers/relPosix'

const ROOT = path.resolve(__dirname, '..', 'src')
const SCOPE = [
  path.join(ROOT, 'components', 'aesa'),
  // AESADashboard hosts the sidebar and its own overlays.
  path.join(ROOT, 'pages'),
]

/** The modal-scrim idiom: position:fixed and inset:0 in one style object. */
const OVERLAY = /position:\s*'fixed'[^}]*inset:\s*0|inset:\s*0[^}]*position:\s*'fixed'/s

function tsxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(dir, f))
}

function aesaFilesWithOverlays(): { file: string; portals: boolean }[] {
  const out: { file: string; portals: boolean }[] = []
  for (const dir of SCOPE) {
    for (const file of tsxFiles(dir)) {
      // Only AESA-scoped files: everything under components/aesa, plus the
      // AESA page itself. Other pages are out of scope -- the defect needs a
      // stacking-context ancestor, and claiming it for every overlay in the
      // app would be a claim this test has not checked.
      const isAesa =
        file.includes(`${path.sep}aesa${path.sep}`) || file.endsWith('AESADashboard.tsx')
      if (!isAesa) continue
      const src = fs.readFileSync(file, 'utf8')
      if (!OVERLAY.test(src)) continue
      out.push({ file: relPosix(ROOT, file), portals: src.includes('createPortal') })
    }
  }
  return out
}

describe('AESA sidebar overlays must portal', () => {
  it('every fixed-inset overlay under AESA portals to document.body', () => {
    const offenders = aesaFilesWithOverlays().filter((x) => !x.portals).map((x) => x.file)
    expect(
      offenders,
      'These render a `position: fixed` overlay inside the sticky configuration ' +
        'sidebar without createPortal. The overlay will be visible but its ' +
        'buttons unreachable, because positioned content in the sibling <main> ' +
        'paints over it. Wrap the returned element in ' +
        'createPortal(<…>, document.body) — see the Patch 4X note in ' +
        'ConfigSidebar.tsx.',
    ).toEqual([])
  })

  it('is not vacuous: it actually finds the overlays it polices', () => {
    const found = aesaFilesWithOverlays()
    // Known overlay-bearing components at the time of writing. A drop below
    // this means the regex stopped matching and the rule passes by finding
    // nothing -- the failure mode that makes a green guard worthless.
    expect(found.length).toBeGreaterThanOrEqual(6)
    const names = found.map((x) => path.basename(x.file))
    for (const required of [
      'ConfigWorkbookButtons.tsx',
      'LayerEditModal.tsx',
      'PrinciplesEditor.tsx',
      'ConfigSidebar.tsx',
    ]) {
      expect(names).toContain(required)
    }
  })

  it('would flag an un-portalled overlay', () => {
    // The detector, applied to a synthetic offender and to a compliant file,
    // so a change to OVERLAY that stops matching fails here rather than
    // silently emptying the sweep above.
    const offender = `const s = { position: 'fixed', inset: 0, zIndex: 1000 }\nreturn (<div style={s} />)`
    const compliant = `import { createPortal } from 'react-dom'\nconst s = { position: 'fixed', inset: 0 }\nreturn createPortal(<div style={s} />, document.body)`
    expect(OVERLAY.test(offender)).toBe(true)
    expect(offender.includes('createPortal')).toBe(false)
    expect(OVERLAY.test(compliant)).toBe(true)
    expect(compliant.includes('createPortal')).toBe(true)
  })
})

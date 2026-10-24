// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// © Copyright 2026 Technical University of Denmark
// Lead developer: Leonardo Ferhati

/**
 * Every modal that can have an in-app dialog stacked on it closes from its
 * backdrop through useBackdropDismiss, never through a bare onClick. A bare
 * `onClick` (even with `e.target === e.currentTarget`) closes the modal when a
 * press starts in one of its fields and is released over the backdrop.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../src')
const MODALS = [
  'components/parameters/ParameterManagerPanel.tsx',
  'components/dsm/ScenarioManagerModal.tsx',
  'components/impact/MethodLibrary.tsx',
  'components/bom/BulkLearningRateModal.tsx',
  'components/bom/BulkReboundModal.tsx',
  'components/aesa/PrinciplesEditor.tsx',
  'components/aesa/LayerEditModal.tsx',
  'pages/Archetypes.tsx',
]

describe('dialog-hosting modals use useBackdropDismiss', () => {
  it.each(MODALS)('%s', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    expect(src).toMatch(/useBackdropDismiss\(/)
    expect(src).not.toMatch(/onClick=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) on(Close|Cancel)\(\) \}\}/)
  })
})

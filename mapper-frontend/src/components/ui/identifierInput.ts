/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

/**
 * Props for a field that holds an IDENTIFIER (parameter name, case name,
 * principle id, folder path, stage or scenario name, machine name).
 *
 * macOS capitalises the first letter typed into a text field and corrects
 * spelling. A parameter name must be lowercase, so every new parameter began
 * with a refused capital the user then had to select and fix. Spread these on
 * the input: `<input {...IDENTIFIER_INPUT_PROPS} … />`.
 */
export const IDENTIFIER_INPUT_PROPS = {
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const

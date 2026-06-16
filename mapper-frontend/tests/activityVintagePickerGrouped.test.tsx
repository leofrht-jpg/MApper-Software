/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ActivityVintagePicker } from '../src/components/impact/ActivityVintagePicker'
import type { ProspectiveDB } from '../src/api/client'
import type { ActivityProductItem } from '../src/components/shared/productItem'

// Patch 5Z — ActivityVintagePicker mirrors the single-item LCI scenarios
// grouped template: premise vintages grouped by scenario (model · ssp-budget)
// with per-group ALL YEARS / CLEAR; the static option stays ungrouped above.
// The grouping/controls are DISPLAY-ONLY — the checked→comparison-item mapping
// is unchanged.

const BASE = 'ei-3.10'
const CODE = 'elec'
const ACTIVITY: ActivityProductItem = {
  type: 'activity', database: BASE, code: CODE, amount: 1,
  display_name: 'market for electricity, low voltage', name: 'market for electricity, low voltage',
  product: 'electricity, low voltage', location: 'DK', unit: 'kWh',
} as any

const db = (ssp: string, year: number): ProspectiveDB => ({
  name: `${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`, base_db: BASE,
  iam: 'remind', ssp, year, years: [year], mode: 'separate', created_at: '',
} as any)

const DBS: ProspectiveDB[] = [
  db('SSP1-PkBudg1150', 2030), db('SSP1-PkBudg1150', 2040),
  db('SSP2', 2030), db('SSP2', 2040),
]

beforeEach(() => {
  // @ts-expect-error stub
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

function renderPicker(onAdd = vi.fn()) {
  return render(
    <ActivityVintagePicker activity={ACTIVITY} databases={DBS} existingKeys={new Set()} onAdd={onAdd} onCancel={vi.fn()} />,
  )
}

const groupKey = (ssp: string) => `${BASE}|remind|${ssp}`
const yr = (ssp: string, year: number) => `vintage-option-${BASE}_premise_remind_${ssp.toLowerCase()}_${year}`

describe('ActivityVintagePicker — grouped by scenario (Patch 5Z)', () => {
  it('renders the static option above scenario groups with year checkboxes', () => {
    const { getByTestId } = renderPicker()
    // Static (ecoinvent) ungrouped option.
    expect(getByTestId(`vintage-option-${BASE}`)).toBeInTheDocument()
    // Two scenario groups, each with year checkboxes.
    expect(getByTestId(`vintage-group-header-${groupKey('SSP1-PkBudg1150')}`).textContent).toBe('remind · SSP1-PkBudg1150')
    expect(getByTestId(`vintage-group-header-${groupKey('SSP2')}`).textContent).toBe('remind · SSP2')
    expect(getByTestId(yr('SSP1-PkBudg1150', 2030))).toBeInTheDocument()
    expect(getByTestId(yr('SSP2', 2040))).toBeInTheDocument()
  })

  it('per-group ALL YEARS selects every year in that group; other groups untouched', () => {
    const { getByTestId } = renderPicker()
    fireEvent.click(getByTestId(`vintage-group-all-${groupKey('SSP1-PkBudg1150')}`))
    expect((getByTestId(yr('SSP1-PkBudg1150', 2030)) as HTMLInputElement).checked).toBe(true)
    expect((getByTestId(yr('SSP1-PkBudg1150', 2040)) as HTMLInputElement).checked).toBe(true)
    // SSP2 group untouched.
    expect((getByTestId(yr('SSP2', 2030)) as HTMLInputElement).checked).toBe(false)
    // Count reflects only SSP1's 2 years.
    expect(getByTestId('vintage-picker-add').textContent).toContain('2')
  })

  it('per-group CLEAR deselects only that group', () => {
    const { getByTestId } = renderPicker()
    // Select both groups fully.
    fireEvent.click(getByTestId(`vintage-group-all-${groupKey('SSP1-PkBudg1150')}`))
    fireEvent.click(getByTestId(`vintage-group-all-${groupKey('SSP2')}`))
    expect(getByTestId('vintage-picker-add').textContent).toContain('4')
    // Clear SSP1 only → SSP2 stays selected.
    fireEvent.click(getByTestId(`vintage-group-clear-${groupKey('SSP1-PkBudg1150')}`))
    expect((getByTestId(yr('SSP1-PkBudg1150', 2030)) as HTMLInputElement).checked).toBe(false)
    expect((getByTestId(yr('SSP2', 2030)) as HTMLInputElement).checked).toBe(true)
    expect(getByTestId('vintage-picker-add').textContent).toContain('2')
  })

  it('the static option toggles independently of the groups', () => {
    const { getByTestId } = renderPicker()
    const staticInput = getByTestId(`vintage-option-${BASE}`).querySelector('input') as HTMLInputElement
    fireEvent.click(staticInput)
    expect(staticInput.checked).toBe(true)
    // Group years remain unaffected.
    expect((getByTestId(yr('SSP1-PkBudg1150', 2030)) as HTMLInputElement).checked).toBe(false)
    expect(getByTestId('vintage-picker-add').textContent).toContain('1')
  })

  it('Add maps checked vintages to comparison items unchanged (static + per-year, with coords)', () => {
    const onAdd = vi.fn()
    const { getByTestId } = renderPicker(onAdd)
    fireEvent.click(getByTestId(`vintage-option-${BASE}`).querySelector('input') as HTMLInputElement) // static
    fireEvent.click(getByTestId(yr('SSP1-PkBudg1150', 2040)))                                          // one premise year
    fireEvent.click(getByTestId('vintage-picker-add'))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const items = onAdd.mock.calls[0][0] as ActivityProductItem[]
    const byDb = Object.fromEntries(items.map((i) => [i.database, i]))
    // Static item — base DB, no coords.
    expect(byDb[BASE]).toMatchObject({ type: 'activity', database: BASE, code: CODE, vintage_label: 'ecoinvent', year: null })
    // Premise item — its DB + structured coords (mapping unchanged from the flat list).
    const ssp1_2040 = `${BASE}_premise_remind_ssp1-pkbudg1150_2040`
    expect(byDb[ssp1_2040]).toMatchObject({ database: ssp1_2040, iam: 'remind', ssp: 'SSP1-PkBudg1150', year: 2040 })
    expect(items).toHaveLength(2)
  })
})

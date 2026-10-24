/* SPDX-License-Identifier: MPL-2.0 */
/**
 * ToDo 0.3.2: hovering a dot on the AESA radar shows that point's SR. The
 * native <title> on each dot only appears after a delay; the card appears at
 * once and names the boundary, the year, the SR, its zone, impact and SOS.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RadarView } from '../src/components/aesa/RadarView'

const row = (pb_id: string, sr: number, zone: string, year = 2030) => ({
  year, pb_id, pb_name: pb_id.replace(/_/g, ' '), pb_short_name: pb_id.replace(/_/g, ' '),
  ef_indicator: 'EF v3.1', impact: 1234.5, allocated_sos: 1000, sr, zone,
  sharing_principle: 'EpC', layer_factors: [], total_sharing_factor: 0,
  sharing_factor_l1: 0, sharing_factor_l2: 1, boundary_type: 'cumulative', confidence: 'high',
  unit: 'kg CO2 eq', impact_by_cohort: {}, method_label: '',
} as any)

const RESULTS = [
  row('climate_change', 1.2345, 'zone_of_uncertainty'),
  row('land_use', 0.4, 'safe'),
  row('water_use', 2.5, 'high_risk'),
  row('climate_change', 9.9, 'high_risk', 2025),
  row('land_use', 9.9, 'high_risk', 2025),
  row('water_use', 9.9, 'high_risk', 2025),
]

describe('AESA radar: hovering a dot shows that point', () => {
  it('shows the SR, zone, year, impact and SOS of the hovered point only', () => {
    render(<RadarView results={RESULTS} year={2030} />)
    expect(screen.queryByTestId('radar-tooltip')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('radar-dot-climate_change'))
    const tip = screen.getByTestId('radar-tooltip').textContent!
    expect(tip).toContain('2030')
    expect(tip).toContain('SR = 1.235')
    expect(tip).toContain('zone of uncertainty')
    expect(tip).toContain('Allocated SOS')
    expect(tip).not.toContain('9.900')   // not the 2025 value
    fireEvent.mouseLeave(screen.getByTestId('radar-dot-climate_change'))
    expect(screen.queryByTestId('radar-tooltip')).toBeNull()
  })

  it('moving to another dot shows that dot', () => {
    render(<RadarView results={RESULTS} year={2030} />)
    fireEvent.mouseEnter(screen.getByTestId('radar-dot-climate_change'))
    fireEvent.mouseEnter(screen.getByTestId('radar-dot-water_use'))
    fireEvent.mouseLeave(screen.getByTestId('radar-dot-climate_change'))
    const tip = screen.getByTestId('radar-tooltip').textContent!
    expect(tip).toContain('SR = 2.500')
    expect(tip).toContain('high risk')
  })

  it('keyboard focus shows it too', () => {
    render(<RadarView results={RESULTS} year={2030} />)
    fireEvent.focus(screen.getByTestId('radar-dot-land_use'))
    expect(screen.getByTestId('radar-tooltip').textContent).toContain('SR = 0.400')
  })

  it('a not-specified axis reads as a lower bound', () => {
    const gaps = [{ method: ['EF v3.1', 'land use', 'x'], pb_id: 'land_use', activity_name: 'a', database: 'd', scope_note: 'n', kind: 'not_reached' }] as any
    render(<RadarView results={RESULTS} year={2030} coverageGaps={gaps} />)
    fireEvent.mouseEnter(screen.getByTestId('radar-dot-land_use'))
    const tip = screen.getByTestId('radar-tooltip').textContent!
    expect(tip).toContain('SR ≥ 0.400')
    expect(tip).toContain('lower bound')
  })

  it('the card is outside the exported svg', () => {
    const { container } = render(<RadarView results={RESULTS} year={2030} />)
    fireEvent.mouseEnter(screen.getByTestId('radar-dot-climate_change'))
    const svg = container.querySelector('svg[data-chart-export-target]')!
    expect(svg.contains(screen.getByTestId('radar-tooltip'))).toBe(false)
  })
})

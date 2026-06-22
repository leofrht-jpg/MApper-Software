/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

interface Props {
  integerUnits: boolean
  unitName: string
  onIntegerUnitsChange: (v: boolean) => void
  onUnitNameChange: (v: string) => void
}

const labelCol: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-wide)',
  display: 'block',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  backgroundColor: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

const TOOLTIP =
  'This determines whether the engine produces whole numbers or fractional ' +
  'values. You can change this later.'

export function UnitTypePicker({
  integerUnits, unitName, onIntegerUnitsChange, onUnitNameChange,
}: Props) {
  const placeholder = integerUnits ? 'vehicles' : 'kg'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={{ ...labelCol, marginBottom: 0 }} title={TOOLTIP}>
        Unit type
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <OptionCard
          selected={integerUnits}
          onSelect={() => onIntegerUnitsChange(true)}
          title="Discrete units"
          hint="(vehicles, buildings, machines, chargers, …)"
          description="Counts are always whole numbers. Survival and decomposition results are rounded to preserve totals."
        />
        <OptionCard
          selected={!integerUnits}
          onSelect={() => onIntegerUnitsChange(false)}
          title="Continuous quantities"
          hint="(kg, kWh, m³, liters, …)"
          description="Fractional values are allowed. No rounding applied."
        />
      </div>

      <div>
        <label style={labelCol}>Unit name</label>
        <input
          type="text"
          value={unitName}
          onChange={(e) => onUnitNameChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
          Display label used in charts and exports — e.g., "vehicles", "turbines", "kg", "kWh".
        </div>
      </div>
    </div>
  )
}

interface OptionCardProps {
  selected: boolean
  onSelect: () => void
  title: string
  hint: string
  description: string
}

function OptionCard({ selected, onSelect, title, hint, description }: OptionCardProps) {
  return (
    <label
      onClick={onSelect}
      title={TOOLTIP}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: 'var(--space-3) var(--space-4)',
        border: `1px solid ${selected ? 'var(--mod-dsm)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        backgroundColor: selected
          ? 'color-mix(in srgb, var(--mod-dsm) 8%, transparent)'
          : 'var(--bg-elevated)',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'border-color var(--duration-fast), background var(--duration-fast)',
      }}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        style={{ marginTop: 3, accentColor: 'var(--mod-dsm)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>
          {title}{' '}
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{hint}</span>
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {description}
        </span>
      </div>
    </label>
  )
}

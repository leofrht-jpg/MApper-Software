import { describe, it, expect } from 'vitest'
import { evaluateAxisConflict } from '../src/utils/axisConflict'

describe('evaluateAxisConflict — single-axis (allowed)', () => {
  it('all axes at N=1 → no conflict', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 1 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual([])
    expect(r.message).toBeNull()
  })

  it('only LCI > 1 → no conflict', () => {
    const r = evaluateAxisConflict({ lci: 3, dsm: 1, parameter: 1 })
    expect(r.conflict).toBe(false)
    expect(r.message).toBeNull()
  })

  it('only DSM > 1 → no conflict', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 4, parameter: 1 })
    expect(r.conflict).toBe(false)
    expect(r.message).toBeNull()
  })

  it('only Parameter > 1 → no conflict', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 5 })
    expect(r.conflict).toBe(false)
    expect(r.message).toBeNull()
  })
})

describe('evaluateAxisConflict — pairwise conflicts', () => {
  it('LCI × DSM → conflict, names both', () => {
    const r = evaluateAxisConflict({ lci: 2, dsm: 2, parameter: 1 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['LCI', 'DSM'])
    expect(r.message).toBe(
      'Cannot run multi-LCI-scenario with multi-DSM-scenario in the same calculation. Choose one axis.'
    )
  })

  it('LCI × Parameter → conflict, names both', () => {
    const r = evaluateAxisConflict({ lci: 2, dsm: 1, parameter: 3 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['LCI', 'Parameter'])
    expect(r.message).toBe(
      'Cannot run multi-LCI-scenario with multi-Parameter-scenario in the same calculation. Choose one axis.'
    )
  })

  it('DSM × Parameter → conflict, names both', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 2, parameter: 3 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['DSM', 'Parameter'])
    expect(r.message).toBe(
      'Cannot run multi-DSM-scenario with multi-Parameter-scenario in the same calculation. Choose one axis.'
    )
  })
})

describe('evaluateAxisConflict — three-way conflict', () => {
  it('all three axes > 1 → conflict, names all three in canonical order', () => {
    const r = evaluateAxisConflict({ lci: 2, dsm: 2, parameter: 2 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['LCI', 'DSM', 'Parameter'])
    expect(r.message).toBe(
      'Cannot run multi-LCI-scenario with multi-DSM-scenario with multi-Parameter-scenario in the same calculation. Choose one axis.'
    )
  })
})

describe('evaluateAxisConflict — boundary', () => {
  it('N=0 is treated like N=1 (no fan-out)', () => {
    // Empty selection should never trigger axis conflict on its own — it's
    // surfaced as a missing-input issue elsewhere, not as a conflict.
    const r = evaluateAxisConflict({ lci: 0, dsm: 2, parameter: 0 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual(['DSM'])
  })
})

describe('evaluateAxisConflict — paired axis (Patch 2F.2)', () => {
  it('paired alone (>1) → no conflict, paired listed', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 1, paired: 3 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual(['Paired'])
  })

  it('paired omitted (undefined) → no axis listed for paired', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 1 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual([])
  })

  it('paired = 0 → no axis listed for paired', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 1, paired: 0 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual([])
  })

  it('paired = 1 → no fan-out (degenerate single-pair, behaves like single)', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 1, paired: 1 })
    expect(r.conflict).toBe(false)
    expect(r.axes).toEqual([])
  })

  it('paired × Parameter → conflict, names both', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 1, parameter: 3, paired: 3 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['Parameter', 'Paired'])
    expect(r.message).toBe(
      'Cannot run multi-Parameter-scenario with multi-Paired-scenario in the same calculation. Choose one axis.'
    )
  })

  it('paired × LCI → conflict (e.g. user accidentally left multi-LCI selected before switching to paired)', () => {
    const r = evaluateAxisConflict({ lci: 3, dsm: 1, parameter: 1, paired: 3 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['LCI', 'Paired'])
  })

  it('paired × DSM → conflict', () => {
    const r = evaluateAxisConflict({ lci: 1, dsm: 3, parameter: 1, paired: 3 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['DSM', 'Paired'])
  })

  it('all four axes > 1 → conflict, lists all four in canonical order', () => {
    const r = evaluateAxisConflict({ lci: 2, dsm: 2, parameter: 2, paired: 2 })
    expect(r.conflict).toBe(true)
    expect(r.axes).toEqual(['LCI', 'DSM', 'Parameter', 'Paired'])
  })
})

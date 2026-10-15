import { describe, expect, it } from 'vitest'
import { outsideWorkDateLabel } from './outsideWorkDateLabels'

describe('outside-work calendar date labels', () => {
  it.each([
    ['2026-10-12', 'الاثنين — 12/10/2026'],
    ['2026-10-13', 'الثلاثاء — 13/10/2026'],
    ['2026-10-14', 'الأربعاء — 14/10/2026'],
    ['2026-10-18', 'الأحد — 18/10/2026'],
  ])('%s has the correct operational weekday', (date, expected) => {
    expect(outsideWorkDateLabel(date)).toBe(expected)
  })
  it('formats week endpoints without changing their dates', () => {
    expect(['2026-10-12', '2026-10-18'].map(date => outsideWorkDateLabel(date, 'ar', true)).join(' → '))
      .toBe('الاثنين 12/10/2026 → الأحد 18/10/2026')
  })
})

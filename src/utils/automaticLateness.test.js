import { expect, it } from 'vitest'
import { automaticLateDeduction, latenessStatus } from './biometricLateness'
const context = { daily_wage: 26923.08, scheduled_paid_minutes: 540, fingerprint: 'current' }
it.each([[155,7727.92],[120,5982.91],[1,49.86],[0,0]])('canonical monthly daily equivalent and %s minutes give %s without per-minute rounding', (minutes, amount) => {
  expect(automaticLateDeduction(context, minutes)).toBe(amount)
})
it.each([[540,555.56],[390,769.23],[810,370.37]])('weekly daily wage uses actual %s scheduled minutes', (paid, amount) => {
  expect(automaticLateDeduction({daily_wage:10000,scheduled_paid_minutes:paid},30)).toBe(amount)
})
it('rounds exact half cents only at final amount; no unsupported or missing wage/schedule is invented', () => {
  expect(automaticLateDeduction({daily_wage:1,scheduled_paid_minutes:200},1)).toBe(.01)
  for (const invalid of [null,{}, {...context,daily_wage:null},{...context,scheduled_paid_minutes:0},{...context,unavailable_reason:'Schedule missing'}])
    expect(automaticLateDeduction(invalid,30)).toBeNull()
  for (const minutes of [-1,'',1.5,1441]) expect(automaticLateDeduction(context,minutes)).toBeNull()
})
it('changed wage/schedule context is stale independently of the original check-in', () => {
  const row = {calculation:context,evidence:{source_fingerprint:'raw'},review:{decision:'approved',source_fingerprint:'raw',calculation_snapshot:{mode:'automatic_daily_wage_v1',fingerprint:'old'}}}
  expect(latenessStatus(row)).toBe('stale')
  row.review.calculation_snapshot.fingerprint='current'
  expect(latenessStatus(row)).toBe('approved')
})

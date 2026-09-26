import { test } from 'node:test'
import assert from 'node:assert/strict'
import { morningLateness } from './src/utils/morningLateness.js'
import { translations } from './src/i18n/translations.js'
test('canonical lateness is informational and localized', () => {
  for (const lang of ['ar', 'en', 'fr']) {
    const t = key => translations[lang].attendance[key.split('.')[1]]
    const row = { status: 'present', check_out: null, biometric_sync_metadata: { lateness_seconds: 5270 } }
    assert.equal(morningLateness(row, t), `1${t('attendance.hourShort')} 27${t('attendance.minuteShort')}`)
    assert.equal(row.status, 'present')
    assert.equal(row.check_out, null)
    assert.equal(morningLateness({}, t), '—')
  }
})

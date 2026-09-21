import assert from 'node:assert/strict'
import test from 'node:test'
import { translations } from './src/i18n/translations.js'
import { morningVerificationReasonKey } from './src/utils/morningVerificationDiagnostics.js'

test('known morning-verification reasons resolve through translation keys in every supported language', () => {
  const key = morningVerificationReasonKey({ code: 'device_read_failed' })
  for (const language of ['ar', 'en', 'fr']) {
    const value = key.split('.').reduce((current, part) => current?.[part], translations[language])
    assert.equal(typeof value, 'string')
    assert.notEqual(value, 'device_read_failed')
  }
})

test('agent controls and agent state labels are translated in Arabic, English, and French', () => {
  for (const language of ['ar', 'en', 'fr']) {
    const labels = translations[language].agentStatus
    assert.equal(typeof labels.control.start, 'string')
    assert.equal(typeof labels.control.stop, 'string')
    assert.equal(typeof labels.control.restart, 'string')
    assert.equal(typeof labels.states.busy, 'string')
    assert.equal(typeof labels.verificationInProgress, 'string')
  }
})

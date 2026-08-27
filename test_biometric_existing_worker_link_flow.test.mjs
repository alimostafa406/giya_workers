import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { completeCriticalBiometricMappingSave } from './src/utils/biometricMappingSaveFlow.js'

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

test('existing-worker mapping releases UI before detached reconciliation finishes', async () => {
  let linking = true
  let finishReconciliation
  let reconciliationFinished = false
  const slowReconciliation = new Promise((resolve) => { finishReconciliation = resolve })

  const result = await completeCriticalBiometricMappingSave({
    saveMapping: async () => ({ data: { id: 'mapping-1' } }),
    onMapped: () => { linking = false },
    runPostSave: async () => {
      await slowReconciliation
      reconciliationFinished = true
    },
  })

  assert.deepEqual(result, { data: { id: 'mapping-1' } })
  assert.equal(linking, false)
  assert.equal(reconciliationFinished, false)
  finishReconciliation()
  await nextTurn()
  assert.equal(reconciliationFinished, true)
})

test('secondary refresh failure warns without reporting the committed mapping as failed', async () => {
  let mapped = false
  let mappingFailed = false
  let warning = false

  await completeCriticalBiometricMappingSave({
    saveMapping: async () => ({ data: { id: 'mapping-1' } }),
    onMapped: () => { mapped = true },
    runPostSave: async () => { throw new Error('helper unavailable') },
    onPostSaveError: () => { warning = true },
  }).catch(() => { mappingFailed = true })
  await nextTurn()

  assert.equal(mapped, true)
  assert.equal(mappingFailed, false)
  assert.equal(warning, true)
})

test('mapping failure keeps the identity available and skips reconciliation', async () => {
  let optimisticallyRemoved = false
  let reconciliationStarted = false

  await assert.rejects(() => completeCriticalBiometricMappingSave({
    saveMapping: async () => { throw new Error('mapping rejected') },
    onMapped: () => { optimisticallyRemoved = true },
    runPostSave: async () => { reconciliationStarted = true },
  }), /mapping rejected/)

  assert.equal(optimisticallyRemoved, false)
  assert.equal(reconciliationStarted, false)
})

test('existing-worker UI removes only the saved device-scoped identity and refreshes both data sources', async () => {
  const source = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(source, /new Set\(previous\)\.add\(deviceUser\.identityKey\)/)
  assert.match(source, /filter\(\(user\) => !optimisticallyMappedEmployeeNos\.has\(user\.identityKey\)\)/)
  assert.match(source, /Promise\.all\(\[\s*refreshTodayAttendanceAfterMapping\(\),\s*load\(\),\s*loadRecentActivity\(\),\s*\]\)/)
  assert.match(source, /setLinkingWorker\(false\)\s*\n\s*clearSelections\(\)/)
  assert.match(source, /setError\(linkError\?\.message \|\| t\('common\.updateFailed'\)\)/)
  assert.doesNotMatch(source, /window\.location\.reload/)

  const visible = new Set(['office-main::39', 'office-secondary::39'])
  visible.delete('office-secondary::39')
  assert.deepEqual([...visible], ['office-main::39'])
})

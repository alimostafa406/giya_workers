import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { completeCriticalBiometricWorkerCreation } from './src/utils/biometricMappingSaveFlow.js'

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

test('successful RPC releases critical saving state without awaiting slow post-save work', async () => {
  let saving = true
  let finishPostSave
  let postSaveFinished = false
  const slowPostSave = new Promise((resolve) => { finishPostSave = resolve })

  const result = await completeCriticalBiometricWorkerCreation({
    createWorker: async () => ({ worker_id: 'worker-1', mapping_id: 'mapping-1' }),
    onCreated: () => { saving = false },
    runPostSave: async () => { await slowPostSave; postSaveFinished = true },
  })

  assert.deepEqual(result, { worker_id: 'worker-1', mapping_id: 'mapping-1' })
  assert.equal(saving, false)
  assert.equal(postSaveFinished, false)
  finishPostSave()
  await nextTurn()
  assert.equal(postSaveFinished, true)
})

test('secondary failure is reported separately after committed creation', async () => {
  let created = false
  let creationFailed = false
  let secondaryWarning = false

  await completeCriticalBiometricWorkerCreation({
    createWorker: async () => ({ worker_id: 'worker-1', mapping_id: 'mapping-1' }),
    onCreated: () => { created = true },
    runPostSave: async () => { throw new Error('slow helper failed') },
    onPostSaveError: () => { secondaryWarning = true },
  }).catch(() => { creationFailed = true })
  await nextTurn()

  assert.equal(created, true)
  assert.equal(creationFailed, false)
  assert.equal(secondaryWarning, true)
})

test('creation RPC failure remains a critical failure and starts no refresh', async () => {
  let created = false
  let postSaveStarted = false

  await assert.rejects(() => completeCriticalBiometricWorkerCreation({
    createWorker: async () => { throw new Error('creation failed') },
    onCreated: () => { created = true },
    runPostSave: async () => { postSaveStarted = true },
  }), /creation failed/)

  assert.equal(created, false)
  assert.equal(postSaveStarted, false)
})

test('UI prevents duplicate creation, removes identity optimistically, and preserves reconciliation', async () => {
  const source = await readFile(new URL('./src/pages/BiometricMapping.jsx', import.meta.url), 'utf8')

  assert.match(source, /if \(!selectedDevice \|\| creatingWorker\) return/)
  assert.match(source, /isSaving=\{creatingWorker\}/)
  assert.match(source, /setOptimisticallyMappedEmployeeNos/)
  assert.match(source, /filter\(\(user\) => !optimisticallyMappedEmployeeNos\.has\(user\.identityKey\)\)/)
  assert.match(source, /refreshTodayAttendanceAfterMapping\(\)/)
  assert.match(source, /saveBiometricMappingRequest\(/)
  assert.doesNotMatch(source, /await refreshTodayAttendanceAfterMapping\(\)\s*\n\s*await load\(\)\s*\n\s*clearSelections\(\)/)
})

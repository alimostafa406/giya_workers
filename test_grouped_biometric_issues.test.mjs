import assert from 'node:assert/strict'
import test from 'node:test'


test('confirmed worker issues merge devices, retain all eight punches, and do not merge BENI', async () => {
  const { groupUnresolvedBiometricAttendance } = await import('./src/utils/unresolvedBiometricAttendance.js')
  const pitshou = Array.from({ length: 8 }, (_, i) => ({
    event_id: String(i), attendance_date: '2026-11-26', event_timestamp: '2026-11-26T06:' + (33 + i) + ':08Z',
    worker_id: 'pitshou-70', mapping_review_state: 'confirmed', device_employee_no: '094',
    device_id: i % 2 ? 'office-main' : 'office-secondary', resolution_reason: 'outside_attendance_window',
  }))
  const beni = { event_id: 'beni', attendance_date: '2026-11-26', device_id: 'office-main', device_employee_no: '033', resolution_reason: 'unmapped' }
  const groups = groupUnresolvedBiometricAttendance([...pitshou, beni])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].events.length, 8)
  assert.deepEqual(groups[0].devices, ['office-main', 'office-secondary'])
  assert.equal(groups[1].resolution_reason, 'unmapped')
  assert.equal(groupUnresolvedBiometricAttendance([...pitshou, { ...pitshou[0], event_id: 'other-day', attendance_date: '2026-11-25' }]).length, 2)
  assert.equal(groupUnresolvedBiometricAttendance([beni, { ...beni, event_id: 'different-string', device_employee_no: '33' }, { ...beni, event_id: 'different-device', device_id: 'office-secondary' }]).length, 3)
  assert.equal(groupUnresolvedBiometricAttendance([...pitshou, pitshou[0]])[0].events.length, 8)
})

import { isActiveWorker } from './activeWorkers.js'
import { safeBiometricDisplayName } from './biometricDisplayName.js'

const normalizeEmployeeNo = (value) => String(value || '').trim()
const normalizeDeviceId = (value) => String(value || '').trim()
export const biometricDeviceIdentityKey = (deviceId, employeeNo) => `${normalizeDeviceId(deviceId)}::${normalizeEmployeeNo(employeeNo)}`

// Current structured UserInfo names are display metadata, never mapping evidence.
export const currentBiometricNamesByIdentity = (identities = []) => new Map(identities
  .filter((identity) => identity?.is_current === true)
  .map((identity) => [
    biometricDeviceIdentityKey(identity.device_id, identity.device_employee_no),
    safeBiometricDisplayName(identity.device_name),
  ]))

export const buildRecentIdentityUsers = ({ activityIdentities, inventoryUsers, currentIdentityNames, mappings, workers, ignoredEmployeeNos, ignoredIdentities }) => {
  const inventoryByDeviceIdentity = new Map((inventoryUsers || []).map((user) => [
    biometricDeviceIdentityKey(user.deviceId, user.employeeNo), user,
  ]))
  const currentNamesByIdentity = currentBiometricNamesByIdentity(currentIdentityNames)
  const mappingsByDeviceIdentity = new Map()
  const legacyMappingsByEmployeeNo = new Map()
  for (const mapping of mappings || []) {
    const employeeNo = normalizeEmployeeNo(mapping.device_employee_no)
    const mappingKey = mapping.device_id
      ? biometricDeviceIdentityKey(mapping.device_id, employeeNo)
      : employeeNo
    const target = mapping.device_id ? mappingsByDeviceIdentity : legacyMappingsByEmployeeNo
    const existing = target.get(mappingKey)
    if (!existing || (existing.is_active === false && mapping.is_active !== false)) {
      target.set(mappingKey, mapping)
    }
  }
  const activeWorkerIds = new Set((workers || [])
    .filter((worker) => worker?.id && isActiveWorker(worker))
    .map((worker) => String(worker.id)))
  const ignored = new Set((ignoredEmployeeNos || []).map(normalizeEmployeeNo))
  const scopedIgnored = new Set((ignoredIdentities || [])
    .filter((row) => row?.device_id)
    .map((row) => biometricDeviceIdentityKey(row.device_id, row.device_employee_no)))
  const legacyIgnored = new Set((ignoredIdentities || [])
    .filter((row) => !row?.device_id)
    .map((row) => normalizeEmployeeNo(row.device_employee_no)))

  return (activityIdentities || []).map((activity) => {
    const employeeNo = normalizeEmployeeNo(activity.employeeNo)
    const deviceId = normalizeDeviceId(activity.deviceId || activity.devices_seen?.[0])
    const identityKey = biometricDeviceIdentityKey(deviceId, employeeNo)
    const inventoryUser = inventoryByDeviceIdentity.get(identityKey) || {}
    const mapping = inventoryUser.mapping
      || mappingsByDeviceIdentity.get(identityKey)
      || legacyMappingsByEmployeeNo.get(employeeNo)
      || null
    return {
      ...inventoryUser,
      employeeNo,
      deviceId,
      identityKey,
      // Prefer the current structured device name for this exact device+ID.
      // Persisted event names are historical display metadata, not identity proof.
      name: currentNamesByIdentity.get(identityKey) || safeBiometricDisplayName(inventoryUser.name) || safeBiometricDisplayName(activity.name),
      devices: activity.devices_seen || inventoryUser.devices || [],
      mapping,
      hasActiveMapping: mapping?.is_active === true,
      hasActiveWorkerMapping: Boolean(
        mapping?.is_active === true
        && mapping?.worker_id
        && activeWorkerIds.has(String(mapping.worker_id)),
      ),
      ignored: inventoryUser.ignored || scopedIgnored.has(identityKey) || legacyIgnored.has(employeeNo) || ignored.has(employeeNo),
      recentEventCount: Number(activity.recent_event_count || 0),
      firstRecentEventAt: activity.first_event_at || null,
      latestRecentEventAt: activity.latest_event_at || null,
    }
  })
}

export const recentUnmappedIdentityUsers = (users) => (users || [])
  .filter((user) => user.deviceId && user.employeeNo && user.recentEventCount > 0)
  // The admin RPC has already decided safe current mapping status. An active
  // but unconfirmed/conflicting mapping must not be hidden again by the UI.
  .filter((user) => !user.ignored)
  .sort((a, b) => new Date(b.latestRecentEventAt || 0) - new Date(a.latestRecentEventAt || 0)
    || String(a.name || '').localeCompare(String(b.name || '')))

let locallySyncedUsers = null

export const replaceHikvisionDeviceUsers = (users) => {
  locallySyncedUsers = Array.isArray(users) ? users : null
}

export const normalizeDeviceEmployeeNo = (value) => String(value || '').trim()

export const normalizePersonName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase()

// Device inventory is populated only by the current local Helper sync response.
// Historical device dumps must never be bundled into the production frontend.
export const getHikvisionDeviceUsers = () => {
  const usersByDeviceIdentity = new Map()

  ;(locallySyncedUsers || []).forEach((user) => {
    const employeeNo = normalizeDeviceEmployeeNo(user.employeeNo || user.employeeNoString)
    if (!employeeNo) return
    const activityEvents = Array.isArray(user.activityEvents) ? user.activityEvents : []
    const devices = Array.isArray(user.devices) ? user.devices : []
    devices.forEach((deviceId) => {
      const identityKey = `${deviceId}::${employeeNo}`
      if (usersByDeviceIdentity.has(identityKey)) return
      usersByDeviceIdentity.set(identityKey, {
        employeeNo,
        deviceId,
        identityKey,
        name: String(user.name || '').trim() || 'بدون اسم',
        isDeviceUserActive: user.Valid?.enable !== false && user._local_sync?.is_currently_returned !== false,
        isCurrentlyReturned: user._local_sync?.is_currently_returned !== false,
        removedFromAllDevices: user._local_sync?.removed_from_all_devices === true,
        devices: [deviceId],
        devicePresence: user.device_presence || {},
        activityEvents: activityEvents.filter((event) => (event._device_id || event.device_id) === deviceId),
        latestEvent: activityEvents.find((event) => (event._device_id || event.device_id) === deviceId) || null,
        faceEnrolled: Number(user.numOfFace || 0) > 0,
      })
    })
  })

  return Array.from(usersByDeviceIdentity.values())
}

export const getHikvisionRawStats = () => {
  const users = getHikvisionDeviceUsers()
  return {
    usersCount: users.length,
    usersWithRegisteredFace: users.filter((user) => user.faceEnrolled).length,
  }
}

let locallySyncedUsers = null

export const replaceHikvisionDeviceUsers = (users) => {
  locallySyncedUsers = Array.isArray(users) ? users : null
}

export const normalizeDeviceEmployeeNo = (value) => String(value || '').trim()

export const normalizePersonName = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase()

// Device inventory is populated only by the current local Helper sync response.
// Historical device dumps must never be bundled into the production frontend.
export const getHikvisionDeviceUsers = () => {
  const usersByEmployeeNo = new Map()

  ;(locallySyncedUsers || []).forEach((user) => {
    const employeeNo = normalizeDeviceEmployeeNo(user.employeeNo || user.employeeNoString)
    if (!employeeNo || usersByEmployeeNo.has(employeeNo)) return
    const activityEvents = Array.isArray(user.activityEvents) ? user.activityEvents : []

    usersByEmployeeNo.set(employeeNo, {
      employeeNo,
      name: String(user.name || '').trim() || 'بدون اسم',
      isDeviceUserActive: user.Valid?.enable !== false && user._local_sync?.is_currently_returned !== false,
      isCurrentlyReturned: user._local_sync?.is_currently_returned !== false,
      removedFromAllDevices: user._local_sync?.removed_from_all_devices === true,
      devices: Array.isArray(user.devices) ? user.devices : [],
      devicePresence: user.device_presence || {},
      activityEvents,
      latestEvent: activityEvents[0] || null,
      faceEnrolled: Number(user.numOfFace || 0) > 0,
    })
  })

  return Array.from(usersByEmployeeNo.values())
}

export const getHikvisionRawStats = () => {
  const users = getHikvisionDeviceUsers()
  return {
    usersCount: users.length,
    usersWithRegisteredFace: users.filter((user) => user.faceEnrolled).length,
  }
}

import rawEvents from '../../hikvision_raw/attendance_2026-08-10_ALL.json'
import rawUsers from '../../hikvision_raw/hikvision_users_ALL.json'

let locallySyncedUsers = null

export const replaceHikvisionDeviceUsers = (users) => {
  locallySyncedUsers = Array.isArray(users) ? users : null
}

export const normalizeDeviceEmployeeNo = (value) => String(value || '').trim()

export const normalizePersonName = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase()

const getEventsByEmployeeNo = () => {
  const events = new Map()
  rawEvents.forEach((event) => {
    const employeeNo = normalizeDeviceEmployeeNo(event.employeeNoString || event.employeeNo)
    if (!employeeNo) return
    const activity = {
      time: event.time || null,
      deviceId: event._device_id || event.device_id || event.deviceId || null,
      verifyMode: event.currentVerifyMode || null,
      eventName: event.name || null,
    }
    events.set(employeeNo, [...(events.get(employeeNo) || []), activity])
  })
  events.forEach((activity) => activity.sort((left, right) => String(right.time || '').localeCompare(String(left.time || ''))))
  return events
}

// This review workflow intentionally exposes no face-image URL or local helper dependency.
export const getHikvisionDeviceUsers = () => {
  const eventsByEmployeeNo = getEventsByEmployeeNo()
  const usersByEmployeeNo = new Map()

  ;(locallySyncedUsers || rawUsers).forEach((user) => {
    const employeeNo = normalizeDeviceEmployeeNo(user.employeeNo || user.employeeNoString)
    if (!employeeNo || usersByEmployeeNo.has(employeeNo)) return

    usersByEmployeeNo.set(employeeNo, {
      employeeNo,
      name: String(user.name || '').trim() || 'بدون اسم',
      isDeviceUserActive: user.Valid?.enable !== false && user._local_sync?.is_currently_returned !== false,
      isCurrentlyReturned: user._local_sync?.is_currently_returned !== false,
      removedFromAllDevices: user._local_sync?.removed_from_all_devices === true,
      devices: Array.isArray(user.devices) ? user.devices : [],
      devicePresence: user.device_presence || {},
      activityEvents: eventsByEmployeeNo.get(employeeNo) || [],
      latestEvent: (eventsByEmployeeNo.get(employeeNo) || [])[0] || null,
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

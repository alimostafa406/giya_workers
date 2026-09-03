export const ATTENDANCE_OPEN_HOUR = 9
export const ATTENDANCE_OPEN_MINUTE = 30
export const ATTENDANCE_REFRESH_INTERVAL_MS = 30_000
export const KINSHASA_TIME_ZONE = 'Africa/Kinshasa'

const clockFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KINSHASA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export const kinshasaClock = (value = new Date()) => {
  const parts = Object.fromEntries(clockFormatter.formatToParts(value)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

export const isAttendancePageLocked = ({ selectedDate, now = new Date() }) => {
  const clock = kinshasaClock(now)
  if (selectedDate !== clock.date) return false
  return (clock.hour * 60) + clock.minute < (ATTENDANCE_OPEN_HOUR * 60) + ATTENDANCE_OPEN_MINUTE
}

export const millisecondsUntilAttendanceOpens = ({ selectedDate, now = new Date() }) => {
  if (!isAttendancePageLocked({ selectedDate, now })) return 0
  const clock = kinshasaClock(now)
  const elapsedMilliseconds = (((clock.hour * 60) + clock.minute) * 60 + clock.second) * 1000 + now.getMilliseconds()
  const openingMilliseconds = ((ATTENDANCE_OPEN_HOUR * 60) + ATTENDANCE_OPEN_MINUTE) * 60 * 1000
  return Math.max(0, openingMilliseconds - elapsedMilliseconds)
}

export const prepareAttendanceOutput = async ({ locked, refresh, generate }) => {
  if (locked) return { ok: false, reason: 'locked' }
  try {
    const snapshot = await refresh()
    await generate(snapshot)
    return { ok: true, reason: null }
  } catch (error) {
    return { ok: false, reason: 'refresh_failed', error }
  }
}

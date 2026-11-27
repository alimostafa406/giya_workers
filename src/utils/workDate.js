import { kinshasaClock } from './attendanceOperationalGate.js'

// Calendar dates are not instants. Never parse user date-only text as UTC/local time.
export const canonicalWorkDate = value => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const display = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!iso && !display) return null
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(display[3]), Number(display[2]), Number(display[1])]
  if (year < 1 || month < 1 || month > 12) return null
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > days[month - 1]) return null
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}
export const requireCanonicalWorkDate = value => {
  const date = canonicalWorkDate(value)
  if (!date) throw new Error('Invalid work date; use YYYY-MM-DD or DD/MM/YYYY')
  return date
}
export const isNonFutureKinshasaWorkDate = (value, now = new Date()) => {
  const date = canonicalWorkDate(value)
  return Boolean(date && Number(date.replaceAll('-', '')) <= Number(kinshasaClock(now).date.replaceAll('-', '')))
}

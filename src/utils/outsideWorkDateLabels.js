// Interpret date-only values at operational noon, never as UTC midnight.
export function outsideWorkDateLabel(value, language = 'ar', range = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '—'
  const date = new Date(`${value}T12:00:00+01:00`)
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'Africa/Kinshasa' }).format(date)
  const [year, month, day] = value.split('-')
  if (language === 'ar') return `${weekday}${range ? ' ' : ' — '}${day}/${month}/${year}`
  if (range) return value
  return new Intl.DateTimeFormat(language, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Kinshasa' }).format(date)
}

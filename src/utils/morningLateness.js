// Informational canonical metadata only; never changes attendance status.
export function morningLateness(row, t) {
  const metadata = row?.biometric_sync_metadata
  const seconds = Number(metadata?.lateness_seconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return [hours ? `${hours}${t('attendance.hourShort')}` : '', minutes % 60 ? `${minutes % 60}${t('attendance.minuteShort')}` : ''].filter(Boolean).join(' ') || '—'
}

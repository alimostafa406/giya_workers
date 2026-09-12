const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

const addDays = (isoDate, days) => {
  const value = new Date(`${isoDate}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export const normalizeCurrentWeeklyPayrollPublication = (payload = {}) => {
  const period = payload.currentWeek || payload.current_week || payload.period || payload
  return {
    ...period,
    weekStart: period.weekStart || period.week_start || '',
    weekEnd: period.weekEnd || period.week_end || '',
    workerCount: numeric(period.workerCount ?? period.worker_count),
    teamCount: numeric(period.teamCount ?? period.team_count),
    finalizedRunCount: numeric(period.finalizedRunCount ?? period.finalized_run_count),
    unfinishedRunCount: numeric(period.unfinishedRunCount ?? period.unfinished_run_count),
    publicationStatus: period.publicationStatus || period.publication_status || 'unpublished',
    viewerVisible: Boolean(period.viewerVisible ?? period.viewer_visible),
    totals: (period.totals || []).map((total) => ({
      currency: total.currency || total.currencyCode || total.currency_code || 'CDF',
      amount: numeric(total.amount),
    })),
  }
}

export const canPublishCurrentWeeklyPayroll = (period) => Boolean(
  period?.weekStart
  && period.finalizedRunCount > 0
  && period.unfinishedRunCount === 0,
)

export const isPublishedWeeklyPayrollActiveOn = (period, isoDate) => Boolean(
  period?.publicationStatus === 'published'
  && period.weekStart
  && period.weekEnd
  && isoDate >= period.weekStart
  && isoDate <= addDays(period.weekEnd, 1),
)

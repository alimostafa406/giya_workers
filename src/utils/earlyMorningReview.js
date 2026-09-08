export const EARLY_MORNING_DECISIONS = Object.freeze({
  currentDayCheckIn: 'current_day_check_in',
  previousWorkdayCheckOut: 'previous_workday_check_out',
  ignored: 'ignored',
})

export const indexEarlyMorningReviews = ({ reviews = [], workers = [], attendance = [] }) => {
  const workersById = new Map(workers.map((worker) => [String(worker.id), worker]))
  const attendanceByWorkerDate = new Map(attendance.map((row) => [
    `${row.worker_id}::${row.attendance_date}`,
    row,
  ]))
  return reviews.map((review) => ({
    ...review,
    worker: review.worker_id ? workersById.get(String(review.worker_id)) || null : null,
    previousAttendance: review.worker_id
      ? attendanceByWorkerDate.get(`${review.worker_id}::${review.previous_work_date}`) || null
      : null,
    currentAttendance: review.worker_id
      ? attendanceByWorkerDate.get(`${review.worker_id}::${review.current_work_date}`) || null
      : null,
  }))
}

export const reviewDecisionLabel = (decision) => ({
  current_day_check_in: 'دخول ليوم البصمة',
  previous_workday_check_out: 'خروج ليوم العمل السابق',
  ignored: 'تم التجاهل',
}[decision] || 'بانتظار المراجعة')

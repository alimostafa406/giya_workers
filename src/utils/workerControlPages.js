import { isOperationalAttendanceWorkerOnDate } from './activeWorkers.js'
import { buildWorkerControlAlerts } from './workerControlCenter.js'
import { buildWorkerControlSectionMetrics } from './workerControlSectionMetrics.js'
import { buildWorkerControlDetail } from './workerControlDetail.js'

const base = '/worker-control-center'

export const workerControlCategories = [
  { key: 'absent-today', path: `${base}/absent-today`, title: 'الغائبون اليوم', description: 'العمال الذين سُجلت لهم حالة غائب اليوم.' },
  { key: 'consecutive-absence', path: `${base}/consecutive-absence`, title: 'الغياب المتتالي', description: 'عمال لديهم يومان أو أكثر من الغياب أو دون سجل حضور بشكل متتالٍ.' },
  { key: 'weekly', path: `${base}/weekly`, title: 'المراقبة الأسبوعية', description: 'العمال الذين بلغوا حد المتابعة الأسبوعية الحالي.' },
  { key: 'monthly', path: `${base}/monthly`, title: 'المراقبة الشهرية', description: 'العمال الذين لديهم يوم غياب مسجل واحد أو أكثر هذا الشهر.' },
  { key: 'half-day', path: `${base}/half-day`, title: 'مراقبة نصف اليوم', description: 'نصف يوم اليوم أو تكراره خلال الأسبوع أو الشهر.' },
  { key: 'inactive-punched', path: `${base}/inactive-punched`, title: 'عمال غير مفعّلين قاموا بالبصمة', description: 'عمال غير نشطين لديهم بصمات حقيقية مسجلة اليوم.' },
  { key: 'activated-today', path: `${base}/activated-today`, title: 'تم تفعيلهم اليوم', description: 'عمليات التفعيل المسجلة اليوم في سجل التفعيل.' },
  { key: 'returned', path: `${base}/returned`, title: 'عادوا بعد غياب', description: 'العمال الذين عادوا بعد فترة غياب وفق متابعة الحضور الحالية.' },
  { key: 'teams', path: `${base}/teams`, title: 'مراقبة الفرق', description: 'ملخص واقعي للحضور والمتابعة حسب الفريق التشغيلي.' },
]

const byWorker = (rows) => [...new Map(rows.filter((row) => row?.worker?.id).map((row) => [String(row.worker.id), row])).values()]
const eventTime = (event) => String(event?.event_timestamp || '')

export const buildWorkerControlPages = ({ workers = [], attendance = [], events = [], activated = [], mappings = [], today, weekStart, monthStart } = {}) => {
  const source = { workers, attendance, events, activated, mappings, today, weekStart, monthStart }
  const alerts = buildWorkerControlAlerts(source)
  const { halfDayRows, teamRows } = buildWorkerControlSectionMetrics({ ...source, alerts })
  const details = new Map()
  const operationalWorkers = workers.filter((worker) => isOperationalAttendanceWorkerOnDate(worker, today))
  operationalWorkers.forEach((worker) => {
    details.set(String(worker.id), buildWorkerControlDetail({ ...source, worker }))
  })
  const workerById = new Map(workers.map((worker) => [String(worker.id), worker]))
  const inactiveEvents = new Map()
  events.forEach((event) => {
    const worker = workerById.get(String(event.worker_id))
    if (!worker || worker.is_active !== false) return
    const id = String(worker.id)
    const item = inactiveEvents.get(id) || { worker, events: [] }
    item.events.push(event)
    inactiveEvents.set(id, item)
  })
  const inactivePunched = [...inactiveEvents.values()].map((item) => {
    const punches = [...item.events].sort((a, b) => eventTime(a).localeCompare(eventTime(b)))
    return { worker: item.worker, firstPunch: punches[0] || null, lastPunch: punches.at(-1) || null, punchCount: punches.length }
  })
  const activatedToday = byWorker(activated.map((record) => ({
    worker: workerById.get(String(record.worker_id)) || { ...record, id: record.worker_id, is_active: true },
    activation: record,
  })))
  const monthly = [...details.values()].filter((detail) => detail.monthCounts.absent >= 1).map((detail) => ({ worker: detail.worker, detail }))
  const consecutive = byWorker(alerts.filter((alert) => alert.type === 'consecutive_absence')).map((alert) => {
    const days = [...(details.get(String(alert.worker.id))?.month || [])].reverse()
    const currentDates = []
    for (const day of days) {
      if (day.status !== 'absent' && day.status !== 'no_record') break
      currentDates.push(day.date)
    }
    return { ...alert, currentStreak: currentDates.length, currentDates }
  }).filter((row) => row.currentStreak >= 2)
  return {
    alerts,
    details,
    rows: {
      'absent-today': [...details.values()].filter((detail) => detail.today.status === 'absent').map((detail) => ({ worker: detail.worker, detail })),
      'consecutive-absence': consecutive,
      weekly: byWorker(alerts.filter((alert) => alert.type === 'weekly_absence')),
      monthly,
      'half-day': halfDayRows,
      'inactive-punched': inactivePunched,
      'activated-today': activatedToday,
      returned: byWorker(alerts.filter((alert) => alert.type === 'returned_after_absence')),
      teams: teamRows,
    },
  }
}

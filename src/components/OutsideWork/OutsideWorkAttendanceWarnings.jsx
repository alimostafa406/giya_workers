import { outsideWorkAttendanceWarnings } from '../../utils/outsideWorkAttendanceWarnings.js'
const labels = {
 ar: { warning: 'تعارض حضور يحتاج مراجعة', history: 'سجل الحضور المحمي',
 note: 'سجل فقط — العمل الخارجي نهائي، ولا يتطلب إجراء من المشرف.' },
 en: { warning: 'Attendance conflict requiring review', history: 'Protected attendance history', note: 'Audit only: Outside Work is FINAL. No supervisor action is required.' },
 fr: { warning: 'Conflit de présence à examiner', history: 'Historique de présence protégée', note: 'Audit uniquement : mission FINAL. Aucune action du superviseur requise.' },
}
export default function OutsideWorkAttendanceWarnings({ conflicts = [], movements = [], date = '', language = 'ar' }) {
 const { unresolved, history } = outsideWorkAttendanceWarnings(conflicts, movements, date)
 const text = labels[language] || labels.en
 const rows = items => <ul>{items.map(row => <li key={row.worker_id + ':' + row.attendance_date}><bdi>{row.worker_name}</bdi> — <bdi>{row.attendance_date}</bdi></li>)}</ul>
 return <>
  {unresolved.length > 0 && <section role="alert" className="alert alert--error mb-4" data-testid="outside-work-unresolved">
   <strong>{text.warning} ({unresolved.length})</strong>{rows(unresolved)}
  </section>}
  {history.length > 0 && <details className="surface-card mb-4 p-3 text-sm text-(--muted) absence-report-screen-only" data-testid="outside-work-attendance-history">
   <summary className="cursor-pointer font-semibold">{text.history}</summary>
   <p className="mt-2">{text.note}</p>{rows(history)}
  </details>}
 </>
}

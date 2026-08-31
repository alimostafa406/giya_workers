import { Link } from 'react-router-dom'

const labels = {
  ar: {
    title: 'مشكلات البصمة التي تتطلب إجراءً',
    description: 'بصمات صحيحة ضمن نافذة الصباح لم تتحول إلى حضور وتحتاج مراجعة فورية.',
    empty: 'لا توجد بصمات صباحية غير مطبقة اليوم.',
    unavailable: 'طبّق ملف مراقبة البصمات غير المحلولة لعرض هذه التنبيهات.',
    review: 'مراجعة الربط',
    worker: 'العامل المرتبط',
    needs_review: 'الربط بحاجة للمراجعة',
    unmapped: 'هوية غير مربوطة',
    inactive_worker: 'العامل المرتبط غير نشط',
    ambiguous: 'تعارض ملكية حقيقي',
    attendance_not_applied: 'الربط مؤكد لكن الحضور لم يُطبّق',
  },
  en: {
    title: 'Unresolved Biometric Attendance',
    description: 'Valid morning-window punches did not become attendance and need immediate review.',
    empty: 'No unapplied morning punches today.',
    unavailable: 'Apply the unresolved biometric monitoring SQL to enable these alerts.',
    review: 'Review mapping',
    worker: 'Mapped worker',
    needs_review: 'Mapping needs review',
    unmapped: 'Unmapped identity',
    inactive_worker: 'Mapped worker is inactive',
    ambiguous: 'Genuine ownership conflict',
    attendance_not_applied: 'Confirmed mapping but attendance was not applied',
  },
  fr: {
    title: 'Présence biométrique non résolue',
    description: 'Des pointages valides du matin ne sont pas devenus des présences et exigent une vérification.',
    empty: 'Aucun pointage matinal non appliqué aujourd’hui.',
    unavailable: 'Appliquez le SQL de suivi biométrique non résolu pour activer ces alertes.',
    review: 'Vérifier la liaison',
    worker: 'Travailleur lié',
    needs_review: 'Liaison à vérifier',
    unmapped: 'Identité non liée',
    inactive_worker: 'Le travailleur lié est inactif',
    ambiguous: 'Conflit réel de propriété',
    attendance_not_applied: 'Liaison confirmée mais présence non appliquée',
  },
}

const localTime = (value) => value
  ? new Date(value).toLocaleTimeString([], { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '—'

export default function UnresolvedBiometricAttendancePanel({ rows = [], unavailable = false, loading = false, language = 'en' }) {
  const text = labels[language] || labels.en
  return (
    <section className="surface-card mb-5 overflow-hidden border-2 border-red-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50 p-4">
        <div>
          <h3 className="font-extrabold text-red-900">{text.title}</h3>
          <p className="mt-1 text-sm text-(--muted)">{text.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-red-200 px-4 py-2 text-xl font-extrabold text-red-900">{loading ? '…' : rows.length}</span>
          <Link className="btn-secondary" to="/biometric-mapping">{text.review}</Link>
        </div>
      </div>
      {unavailable ? <p className="alert alert--warning m-4">{text.unavailable}</p> : null}
      {!unavailable && !loading && rows.length === 0 ? <p className="p-4 text-sm text-(--muted)">{text.empty}</p> : null}
      {!unavailable && rows.length ? (
        <div className="divide-y divide-(--border)">
          {rows.map((row) => (
            <div key={row.event_id} className="grid gap-2 p-4 md:grid-cols-[9rem_1fr_1fr]">
              <div dir="ltr" className="font-bold">{localTime(row.event_timestamp)}</div>
              <div>
                <p className="font-bold">{row.device_name || '—'} <span dir="ltr" className="text-sm text-(--muted)">#{row.device_employee_no}</span></p>
                <p className="text-xs text-(--muted)">{row.device_id}</p>
              </div>
              <div>
                <span className={`status-badge ${row.resolution_reason === 'ambiguous' ? 'status-badge--danger' : 'status-badge--warning'}`}>{text[row.resolution_reason] || row.resolution_reason}</span>
                {row.worker_name ? <p className="mt-1 text-xs">{text.worker}: {row.worker_name} <span dir="ltr">({row.employee_code || '—'})</span></p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

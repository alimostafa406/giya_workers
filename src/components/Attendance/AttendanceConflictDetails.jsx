const ar = {
 title: 'تفاصيل تعارض الحضور',
 protected: 'القرار المحمي', supervisor: 'اختيار المشرف',
 outside: 'العمل الخارجي النهائي (O) يتعارض مع القرار المحمي. يلزم مراجعة الإدارة.',
 matching: 'اختيار المشرف مطابق للقرار المحمي.',
 manual: 'اختيار المشرف يتعارض مع القرار المحمي. لم يتم تغيير الحضور.',
 source: 'المصدر', unknown: 'غير محدد',
 A: 'غائب', P: 'حاضر', O: 'عمل خارجي', M: 'مرضي',
}
const en = { title: 'Attendance conflict details', protected: 'Protected decision', supervisor: 'Supervisor choice',
 outside: 'FINAL Outside Work (O) conflicts with the protected decision. Administration review is required.',
 matching: 'The supervisor choice matches the protected decision.', manual: 'The supervisor choice conflicts with the protected decision. Attendance was not changed.',
 source: 'Source', unknown: 'Not specified', A: 'Absent', P: 'Present', O: 'Outside Work', M: 'Medical' }
const fr = { ...en, title: 'Détails du conflit de présence', protected: 'Décision protégée', supervisor: 'Choix du superviseur',
 outside: 'La mission extérieure FINAL (O) contredit la décision protégée. Révision administrative requise.',
 matching: 'Le choix du superviseur correspond à la décision protégée.', manual: 'Choix incompatible avec la décision protégée. Présence inchangée.',
 source: 'Source', unknown: 'Non spécifié', A: 'Absent', P: 'Présent', O: 'Mission extérieure', M: 'Maladie' }
export default function AttendanceConflictDetails({ rows = [], results = {}, language = 'ar' }) {
 const text = language === 'ar' ? ar : language === 'fr' ? fr : en
 const label = choice => text[choice] ? text[choice] + ' (' + choice + ')' : text.unknown
 const visibleRows = rows.filter(row => row.conflict_type === 'outside_work' || !row.protected_choice
   || (results[row.worker_id] || row.supervisor_choice) !== row.protected_choice)
 if (!visibleRows.length) return null
 return <section role="alert" className="alert alert--error mb-4" aria-label={text.title}>
  <h3 className="font-bold">{text.title}</h3>
  {visibleRows.map(row => {
   const choice = results[row.worker_id] || row.supervisor_choice
   return <div key={row.worker_id + ':' + row.attendance_date} className="mt-3">
    <strong>{row.worker_name} {row.employee_code ? '#' + row.employee_code : ''}</strong> <bdi>{row.attendance_date}</bdi>
    <p>{text.protected}: {label(row.protected_choice)}</p>
    <p>{text.supervisor}: {label(choice)}</p>
    {choice && choice === row.protected_choice && <p>{text.matching}</p>}
    <p>{row.conflict_type === 'outside_work' ? text.outside : text.manual}</p>
    <p className="text-xs">{text.source}: <bdi>{row.attendance_source}</bdi> · <bdi>{row.check_in || '—'} → {row.check_out || '—'}</bdi></p>
   </div>
  })}
 </section>
}

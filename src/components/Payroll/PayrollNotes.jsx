export default function PayrollNotes({ warnings, t }) {
  if (!warnings.length) return null
  return <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4" data-payroll-notes>
    <h3 className="font-extrabold text-amber-950">{t('payroll.notesTitle')}</h3>
    <ul className="mt-2 grid gap-1 text-sm text-amber-900 md:grid-cols-2">
      {warnings.map((warning, index) => <li key={`${warning.workerId}-${warning.field}-${index}`}>
        <strong>{warning.workerName}{warning.employeeCode ? ` #${warning.employeeCode}` : ''}</strong>
        {warning.teamName ? ` — ${warning.teamName}` : ''}
        {` — ${t(`payroll.warning_${warning.field}`)}`}
      </li>)}
    </ul>
  </section>
}

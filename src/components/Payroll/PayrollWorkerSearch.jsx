import { useMemo } from 'react'
import { payrollWorkerSearchResults } from '../../utils/payrollWorkerSearch'

export default function PayrollWorkerSearch({ lines, paymentType, value, onChange, onSelect, t }) {
  const results = useMemo(() => payrollWorkerSearchResults(lines, value, paymentType), [lines, paymentType, value])
  const open = Boolean(value.trim())

  return <div className="surface-card relative mb-4 max-w-2xl p-4" data-payroll-worker-search={paymentType}>
    <label className="block text-sm font-bold">
      <span className="mb-1 block">{t('payroll.workerSearchLabel')}</span>
      <input
        aria-label={t('payroll.workerSearchLabel')}
        className="input-base w-full"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('payroll.workerSearchPlaceholder')}
      />
    </label>
    {open ? <div className="mt-2 overflow-hidden rounded-xl border border-(--border) bg-white" data-payroll-worker-search-results>
      {results.length ? results.map((line) => {
        const worker = line.worker
        return <button
          key={worker.id}
          type="button"
          className="flex w-full items-center justify-between gap-3 border-b border-(--border) px-3 py-2 text-start last:border-b-0 hover:bg-blue-50"
          onClick={() => onSelect(line)}
        >
          <span><strong className="block">{worker.full_name}</strong><span className="text-xs text-(--muted)">{worker.employee_code ? `#${worker.employee_code}` : '—'}</span></span>
          <span className="text-sm font-semibold text-(--muted)">{t('common.team')}: {worker.team_name || t('common.unknown')}</span>
        </button>
      }) : <p className="px-3 py-3 text-sm font-semibold text-(--muted)">{t('common.noResults')}</p>}
    </div> : null}
  </div>
}

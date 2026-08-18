import { useState } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'

const typeKeys = ['bonus', 'deduction', 'advance', 'transport_correction', 'overtime_correction', 'holiday_correction', 'other']
const positiveOnlyTypes = new Set(['bonus', 'deduction', 'advance'])

export default function PayrollAdjustmentsSection({ payrollLine, adjustments, onCreate, onVoid, saving }) {
  const { t } = useTranslation()
  const [type, setType] = useState('bonus')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [voidingId, setVoidingId] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [localError, setLocalError] = useState('')
  const canManage = Boolean(payrollLine)

  const submit = async (event) => {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount === 0 || !reason.trim()) {
      setLocalError(t('payroll.adjustmentRequired'))
      return
    }
    setLocalError('')
    await onCreate({
      adjustmentType: type,
      amount: positiveOnlyTypes.has(type) ? Math.abs(numericAmount) : numericAmount,
      reason: reason.trim(),
    })
    setAmount('')
    setReason('')
  }

  const submitVoid = async (event, adjustmentId) => {
    event.preventDefault()
    if (!voidReason.trim()) {
      setLocalError(t('payroll.voidReasonRequired'))
      return
    }
    setLocalError('')
    await onVoid({ adjustmentId, reason: voidReason.trim() })
    setVoidingId('')
    setVoidReason('')
  }

  return <section className="border-t border-(--border) pt-4">
    <h4 className="font-extrabold">{t('payroll.adjustments')}</h4>
    {!canManage ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('payroll.adjustmentDraftRequired')}</p> : <form className="mt-3 grid gap-2 sm:grid-cols-4" onSubmit={submit}>
      <select className="input-base" value={type} onChange={(event) => setType(event.target.value)}>{typeKeys.map((value) => <option key={value} value={value}>{t(`payroll.adjustmentType_${value}`)}</option>)}</select>
      <input className="input-base" type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={t('payroll.amount')} required />
      <input className="input-base sm:col-span-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('payroll.reason')} required />
      <p className="sm:col-span-3 text-xs text-(--muted)">{t('payroll.adjustmentAmountHelp')}</p><button className="btn-primary" disabled={saving}>{saving ? t('payroll.saving') : t('payroll.addAdjustment')}</button>
    </form>}
    {localError ? <p className="mt-2 text-sm text-red-700">{localError}</p> : null}
    <div className="mt-4 space-y-2">
      {!adjustments.length ? <p className="text-sm text-(--muted)">{t('payroll.noAdjustments')}</p> : adjustments.map((adjustment) => <div key={adjustment.id} className="rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{t(`payroll.adjustmentType_${adjustment.adjustment_type}`)}: {adjustment.amount}</p><span className={adjustment.voided_at ? 'status-badge status-badge--neutral' : 'status-badge status-badge--success'}>{adjustment.voided_at ? t('payroll.voided') : t('payroll.activeAdjustment')}</span></div>
        <p>{t('payroll.reason')}: {adjustment.reason}</p><p className="text-xs text-(--muted)">{t('payroll.createdAt')}: {new Date(adjustment.created_at).toLocaleString()} · {t('payroll.createdBy')}: {adjustment.created_by || '—'}</p>
        {adjustment.voided_at ? <p className="mt-1 text-xs text-(--muted)">{t('payroll.voidReason')}: {adjustment.void_reason || '—'}</p> : <>{voidingId === adjustment.id ? <form className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => submitVoid(event, adjustment.id)}><input className="input-base flex-1" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder={t('payroll.voidReason')} required /><button className="btn-secondary" disabled={saving}>{t('common.confirm')}</button><button type="button" className="btn-secondary" onClick={() => { setVoidingId(''); setVoidReason('') }}>{t('common.cancel')}</button></form> : canManage ? <button type="button" className="btn-secondary mt-2" disabled={saving} onClick={() => setVoidingId(adjustment.id)}>{t('payroll.voidAdjustment')}</button> : null}</>}
      </div>)}
    </div>
  </section>
}

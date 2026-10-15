import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'
import { workerRequiresOperationalTeam } from '../../utils/workerTeamEligibility'
import { attendanceShiftLabels } from '../../utils/attendanceShift'

function WorkerForm({ initialValues, teams, onSubmit, isSaving }) {
  const { t, language } = useTranslation()
  const shiftLabels = attendanceShiftLabels[language] || attendanceShiftLabels.en
  const [attendanceShift, setAttendanceShift] = useState(initialValues?.attendance_shift || 'day')
  const [fullName, setFullName] = useState(initialValues?.full_name || '')
  const employeeCode = initialValues?.employee_code || ''
  const [phone, setPhone] = useState(initialValues?.phone || '')
  const [teamId, setTeamId] = useState(
    initialValues?.team_id || initialValues?.team?.id || '',
  )
  const [isActive, setIsActive] = useState(Boolean(initialValues?.is_active ?? true))
  const [staffClassification, setStaffClassification] = useState(initialValues?.staff_classification || 'normal')
  const [paymentType, setPaymentType] = useState(initialValues?.payment_type || 'weekly')
  const [monthlySalary, setMonthlySalary] = useState(initialValues?.monthly_salary ?? '')

  useEffect(() => {
    setFullName(initialValues?.full_name || '')
    setAttendanceShift(initialValues?.attendance_shift || 'day')
    setPhone(initialValues?.phone || '')
    setTeamId(initialValues?.team_id || initialValues?.team?.id || '')
    setIsActive(Boolean(initialValues?.is_active ?? true))
    setStaffClassification(initialValues?.staff_classification || 'normal')
    setPaymentType(initialValues?.payment_type || 'weekly')
    setMonthlySalary(initialValues?.monthly_salary ?? '')
  }, [initialValues])

  const teamRequired = workerRequiresOperationalTeam({ staff_classification: staffClassification, payment_type: paymentType })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      full_name: fullName,
      ...(initialValues?.id ? { employee_code: employeeCode } : {}),
      phone,
      ...(teamRequired ? { team_id: teamId || null, payment_type: paymentType, monthly_salary: monthlySalary } : {}),
      is_active: isActive,
      staff_classification: staffClassification,
      attendance_shift: attendanceShift,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-semibold">{t('workers.name')}</label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input-base"
          placeholder={t('workers.nameExample')}
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('workers.employeeCode')}</label>
        <input
          value={employeeCode}
          readOnly
          className="input-base"
          placeholder={({ ar: 'سيتم إنشاؤه تلقائيًا', en: 'Automatically generated', fr: 'Généré automatiquement' })[language]}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('workers.phone')}</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input-base"
          placeholder="05xxxxxxxx"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">{t('biometricMapping.operationalClass')}</label>
        <select value={staffClassification} onChange={(e) => setStaffClassification(e.target.value)} className="input-base">
          <option value="normal">{t('biometricMapping.normalWorker')}</option>
          <option value="special_staff">{t('biometricMapping.specialWorker')}</option>
        </select>
      </div>
      {teamRequired && <div>
        <label className="mb-1 block text-sm font-semibold">{t('payroll.paymentType')}</label>
        <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className="input-base">
          <option value="weekly">{t('payroll.weekly')}</option>
          <option value="monthly">{t('payroll.monthly')}</option>
        </select>
      </div>}
      {teamRequired && paymentType === 'monthly' ? <div>
        <label className="mb-1 block text-sm font-semibold">{t('payroll.monthlySalary')}</label>
        <input type="number" min="0" step="any" value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} className="input-base" />
      </div> : null}
      {teamRequired && <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.team')}</label>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="input-base"
          required={teamRequired}
        >
          <option value="">{teamRequired ? t('common.chooseTeam') : t('workers.noTeam')}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        {!teamRequired ? <p className="mt-1 text-xs text-(--muted)">{t('workers.noTeamAllowed')}</p> : null}
      </div>}

      <label className="block text-sm font-semibold">{shiftLabels.title}
        <select aria-label={shiftLabels.title} value={attendanceShift} onChange={(event) => setAttendanceShift(event.target.value)} className="input-base mt-1">
          <option value="day">{shiftLabels.day}</option><option value="night">{shiftLabels.night}</option>
        </select>
      </label>
      <label className="flex items-center gap-2 rounded-xl border border-(--border) bg-white px-3 py-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        {t('workers.active')}
      </label>
      <button type="submit" className="btn-primary" disabled={isSaving}>
        {isSaving ? t('common.saving') : t('common.save')}
      </button>
    </form>
  )
}

export default WorkerForm

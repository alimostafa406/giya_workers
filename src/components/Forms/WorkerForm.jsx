import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'

function WorkerForm({ initialValues, teams, onSubmit, isSaving, requireTeam = true }) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState(initialValues?.full_name || '')
  const [employeeCode, setEmployeeCode] = useState(initialValues?.employee_code || '')
  const [phone, setPhone] = useState(initialValues?.phone || '')
  const [teamId, setTeamId] = useState(
    initialValues?.team_id || initialValues?.team?.id || '',
  )
  const [isActive, setIsActive] = useState(Boolean(initialValues?.is_active ?? true))

  useEffect(() => {
    setFullName(initialValues?.full_name || '')
    setEmployeeCode(initialValues?.employee_code || '')
    setPhone(initialValues?.phone || '')
    setTeamId(initialValues?.team_id || initialValues?.team?.id || '')
    setIsActive(Boolean(initialValues?.is_active ?? true))
  }, [initialValues])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      full_name: fullName,
      employee_code: employeeCode,
      phone,
      team_id: teamId,
      is_active: isActive,
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
          onChange={(e) => setEmployeeCode(e.target.value)}
          className="input-base"
          placeholder="EMP-1001"
          required
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
        <label className="mb-1 block text-sm font-semibold">{t('attendance.team')}</label>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="input-base"
          required={requireTeam}
        >
          <option value="">{t('common.chooseTeam')}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

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

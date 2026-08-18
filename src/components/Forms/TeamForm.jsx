import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'

function TeamForm({ initialValues, supervisors, onSubmit, isSaving }) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialValues?.name || '')
  const [supervisorId, setSupervisorId] = useState(initialValues?.supervisor_id || '')
  const [isActive, setIsActive] = useState(Boolean(initialValues?.is_active ?? true))

  useEffect(() => {
    setName(initialValues?.name || '')
    setSupervisorId(initialValues?.supervisor_id || '')
    setIsActive(Boolean(initialValues?.is_active ?? true))
  }, [initialValues])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      name,
      supervisor_id: supervisorId,
      is_active: isActive,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-semibold">{t('teams.name')}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-base"
          placeholder={t('teams.nameExample')}
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('teams.supervisor')}</label>
        <select
          value={supervisorId}
          onChange={(e) => setSupervisorId(e.target.value)}
          className="input-base"
        >
          <option value="">{t('common.noSupervisor')}</option>
          {supervisors.map((supervisor) => (
            <option key={supervisor.id} value={supervisor.id}>
              {supervisor.full_name}
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
        {t('common.active')}
      </label>
      <button type="submit" className="btn-primary" disabled={isSaving}>
        {isSaving ? t('common.saving') : t('common.save')}
      </button>
    </form>
  )
}

export default TeamForm

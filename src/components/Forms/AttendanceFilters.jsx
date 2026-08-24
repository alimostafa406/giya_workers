import { useTranslation } from '../../i18n/LanguageContext'

function AttendanceFilters({ filters, onChange, teams, workers, onApply }) {
  const { t } = useTranslation()
  return (
    <form
      className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault()
        onApply()
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.date')}</label>
        <input
          type="date"
          value={filters.date}
          onChange={(e) => onChange('date', e.target.value)}
          className="input-base"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.team')}</label>
        <select
          value={filters.team_id}
          onChange={(e) => onChange('team_id', e.target.value)}
          className="input-base"
        >
          <option value="">{t('common.allTeams')}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.worker')}</label>
        <select
          value={filters.worker_id}
          onChange={(e) => onChange('worker_id', e.target.value)}
          className="input-base"
        >
          <option value="">{t('common.allWorkers')}</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.searchWorker')}</label>
        <input
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          className="input-base"
          placeholder={t('attendance.searchWorker')}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">{t('attendance.rosterFilter')}</label>
        <select value={filters.roster_status} onChange={(e) => onChange('roster_status', e.target.value)} className="input-base">
          <option value="all">{t('attendance.filterAll')}</option>
          <option value="present">{t('attendance.filterPresent')}</option>
          <option value="not_recorded">{t('attendance.filterNotRecorded')}</option>
          <option value="absent">{t('attendance.filterAbsent')}</option>
          <option value="review">{t('attendance.filterNeedsReview')}</option>
        </select>
      </div>

      <div className="flex items-end">
        <button type="submit" className="btn-primary w-full">
          {t('attendance.applyFilters')}
        </button>
      </div>
    </form>
  )
}

export default AttendanceFilters

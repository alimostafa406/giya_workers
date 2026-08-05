function AttendanceFilters({ filters, onChange, teams, workers, onApply }) {
  return (
    <form
      className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault()
        onApply()
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-semibold">التاريخ</label>
        <input
          type="date"
          value={filters.date}
          onChange={(e) => onChange('date', e.target.value)}
          className="input-base"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">الفريق</label>
        <select
          value={filters.team_id}
          onChange={(e) => onChange('team_id', e.target.value)}
          className="input-base"
        >
          <option value="">كل الفرق</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">العامل</label>
        <select
          value={filters.worker_id}
          onChange={(e) => onChange('worker_id', e.target.value)}
          className="input-base"
        >
          <option value="">كل العمال</option>
          {workers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold">بحث باسم العامل</label>
        <input
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          className="input-base"
          placeholder="مثال: أحمد"
        />
      </div>

      <div className="flex items-end">
        <button type="submit" className="btn-primary w-full">
          تطبيق الفلاتر
        </button>
      </div>
    </form>
  )
}

export default AttendanceFilters

import { useEffect, useMemo, useState } from 'react'
import { getForeignAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'

const today = () => new Date().toISOString().slice(0, 10)

const statusLabel = (status) => ({
  present: 'حاضر',
  late: 'متأخر',
  half_day: 'نصف يوم',
  absent: 'غائب',
}[status] || 'لم يسجل بعد')

function ForeignAttendance() {
  const [date, setDate] = useState(today)
  const [search, setSearch] = useState('')
  const [teamId, setTeamId] = useState('')
  const [rows, setRows] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const result = await getForeignAttendanceRequest({ date, team_id: teamId || undefined })
        if (!active) return
        setRows(Array.isArray(result.data) ? result.data : [])
        setTeams(Array.isArray(result.teams) ? result.teams : [])
      } catch (err) {
        if (active) setError(getErrorMessage(err))
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [date, teamId])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    if (!term) return rows
    return rows.filter((row) => String(row.worker_name || '').toLocaleLowerCase().includes(term))
  }, [rows, search])

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 p-3 text-slate-900 sm:p-5">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
          <label className="text-sm font-semibold">
            التاريخ
            <input
              type="date"
              className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100"
            onClick={() => setDate(today())}
          >
            اليوم
          </button>
          <label className="min-w-48 flex-1 text-sm font-semibold">
            ابحث باسم العامل
            <input
              type="search"
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="min-w-44 text-sm font-semibold">
            الفريق
            <select
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">كل الفرق</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        </div>

        {error ? <p className="mb-3 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <div className="overflow-x-auto border border-slate-200 bg-white">
          <table className="min-w-[640px] w-full border-collapse text-right text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-bold">العامل</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-bold">الحالة</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-bold">وقت الدخول</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-bold">وقت الخروج</th>
                <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-bold">الفريق</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-500">جارٍ التحميل...</td></tr>
              ) : visibleRows.length ? visibleRows.map((row) => (
                <tr key={row.worker_id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{row.worker_name}</td>
                  <td className="whitespace-nowrap px-4 py-3">{statusLabel(row.status)}</td>
                  <td className="whitespace-nowrap px-4 py-3" dir="ltr">{row.check_in || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3" dir="ltr">{row.check_out || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.team_name}</td>
                </tr>
              )) : (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-500">لا توجد سجلات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}

export default ForeignAttendance

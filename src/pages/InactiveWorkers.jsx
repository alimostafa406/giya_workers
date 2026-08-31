import { useEffect, useMemo, useState } from 'react'
import { getBiometricMappingsRequest, getInactiveWorkerBiometricActivityRequest } from '../api/biometricMappingApi'
import { getErrorMessage } from '../api/axios'
import { getWorkersRequest } from '../api/workersApi'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { buildInactiveWorkerRows } from '../utils/inactiveWorkers'

const labels = {
  ar: {
    title: 'العمال غير النشطين',
    description: 'سجل إداري للعمال غير النشطين وربطهم ونشاطهم البيومتري. هذه الصفحة للعرض فقط ولا تعيد تفعيل العامل أو تنشئ حضورًا.',
    search: 'البحث بالاسم أو الكود أو الفريق أو هوية البصمة',
    total: 'إجمالي العمال غير النشطين',
    activityToday: 'لديهم نشاط بصمة اليوم',
    name: 'العامل',
    code: 'كود الموظف',
    team: 'الفريق السابق / الحالي',
    identities: 'هويات البصمة',
    lastActivity: 'آخر نشاط بصمة متاح',
    today: 'نشاط اليوم',
    detected: 'تم رصد بصمة اليوم',
    noneToday: 'لا توجد بصمة مرصودة اليوم',
    noMapping: 'لا يوجد ربط بيومتري',
    inactive: 'غير نشط',
    empty: 'لا يوجد عمال غير نشطين.',
    unavailable: 'تعذر تحميل مراقبة نشاط البصمة اليوم، لكن قائمة العمال غير النشطين ما زالت متاحة.',
  },
  en: {
    title: 'Inactive Workers',
    description: 'Read-only admin roster of inactive workers, their mappings, and biometric activity. This page never reactivates workers or creates attendance.',
    search: 'Search by name, code, team, or biometric identity',
    total: 'Total inactive workers',
    activityToday: 'With biometric activity today',
    name: 'Worker',
    code: 'Employee code',
    team: 'Previous / current team',
    identities: 'Biometric identities',
    lastActivity: 'Latest available biometric activity',
    today: 'Today activity',
    detected: 'Biometric event detected today',
    noneToday: 'No biometric event detected today',
    noMapping: 'No biometric mapping',
    inactive: 'Inactive',
    empty: 'No inactive workers.',
    unavailable: 'Today’s biometric monitoring could not be loaded, but the inactive-worker roster remains available.',
  },
  fr: {
    title: 'Travailleurs inactifs',
    description: 'Registre administratif en lecture seule des travailleurs inactifs, de leurs liaisons et de leur activité biométrique.',
    search: 'Rechercher par nom, code, équipe ou identité biométrique',
    total: 'Total des travailleurs inactifs',
    activityToday: 'Avec activité biométrique aujourd’hui',
    name: 'Travailleur',
    code: 'Code employé',
    team: 'Équipe précédente / actuelle',
    identities: 'Identités biométriques',
    lastActivity: 'Dernière activité biométrique disponible',
    today: 'Activité du jour',
    detected: 'Événement biométrique détecté aujourd’hui',
    noneToday: 'Aucun événement biométrique détecté aujourd’hui',
    noMapping: 'Aucune liaison biométrique',
    inactive: 'Inactif',
    empty: 'Aucun travailleur inactif.',
    unavailable: 'Le suivi biométrique du jour est indisponible, mais la liste des travailleurs inactifs reste accessible.',
  },
}

const localDateTime = (value, language) => value
  ? new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: 'Africa/Kinshasa', dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date(value))
  : '—'

export default function InactiveWorkers() {
  const { language } = useTranslation()
  const text = labels[language] || labels.en
  const [workers, setWorkers] = useState([])
  const [mappings, setMappings] = useState([])
  const [events, setEvents] = useState([])
  const [monitoringUnavailable, setMonitoringUnavailable] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [workersResult, mappingsResult, eventsResult] = await Promise.all([
          getWorkersRequest(),
          getBiometricMappingsRequest(),
          getInactiveWorkerBiometricActivityRequest().catch(() => ({ data: [], unavailable: true })),
        ])
        setWorkers(Array.isArray(workersResult.data) ? workersResult.data : [])
        setMappings(Array.isArray(mappingsResult.data) ? mappingsResult.data : [])
        setEvents(Array.isArray(eventsResult.data) ? eventsResult.data : [])
        setMonitoringUnavailable(Boolean(eventsResult.unavailable))
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const rows = useMemo(() => buildInactiveWorkerRows({ workers, mappings, unresolvedEvents: events }), [events, mappings, workers])
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((worker) => [
      worker.full_name,
      worker.employee_code,
      worker.team?.name,
      worker.team_name,
      ...worker.biometricMappings.flatMap((mapping) => [mapping.device_id, mapping.device_employee_no, mapping.device_name]),
    ].some((value) => String(value || '').toLowerCase().includes(query)))
  }, [rows, search])
  const activeTodayCount = rows.filter((worker) => worker.biometricEventsToday.length > 0).length

  const columns = [
    { key: 'worker', header: text.name, render: (row) => <div><b>{row.full_name}</b><span className="status-badge status-badge--neutral ms-2">{text.inactive}</span></div> },
    { key: 'code', header: text.code, render: (row) => <span dir="ltr">{row.employee_code || '—'}</span> },
    { key: 'team', header: text.team, render: (row) => row.team?.name || row.team_name || '—' },
    {
      key: 'identities', header: text.identities, render: (row) => row.biometricMappings.length
        ? <div className="space-y-1">{row.biometricMappings.map((mapping) => <div key={mapping.id} dir="ltr" className="text-xs"><b>{mapping.device_id || 'legacy'}:{mapping.device_employee_no}</b> · {mapping.mapping_review_state || '—'} · {mapping.is_active === false ? 'inactive mapping' : 'active mapping'}</div>)}</div>
        : <span className="text-sm text-(--muted)">{text.noMapping}</span>,
    },
    { key: 'last_activity', header: text.lastActivity, render: (row) => <span dir="ltr">{localDateTime(row.latestBiometricEvent?.event_timestamp, language)}</span> },
    {
      key: 'today', header: text.today, render: (row) => row.biometricEventsToday.length
        ? <div><span className="status-badge status-badge--warning">{text.detected}</span><p className="mt-1 text-xs" dir="ltr">{row.biometricEventsToday.map((event) => `${event.device_id || '—'} #${event.device_employee_no} · ${localDateTime(event.event_timestamp, language)}`).join(' | ')}</p></div>
        : <span className="text-sm text-(--muted)">{text.noneToday}</span>,
    },
  ]

  return <section>
    <div className="mb-5"><h2 className="text-2xl font-extrabold">{text.title}</h2><p className="mt-1 text-sm text-(--muted)">{text.description}</p></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      <div className="surface-card p-4"><p className="text-sm text-(--muted)">{text.total}</p><p className="mt-1 text-3xl font-extrabold">{loading ? '…' : rows.length}</p></div>
      <div className="surface-card border-amber-200 bg-amber-50 p-4"><p className="text-sm text-(--muted)">{text.activityToday}</p><p className="mt-1 text-3xl font-extrabold text-amber-800">{loading ? '…' : activeTodayCount}</p></div>
    </div>
    {error ? <p className="alert alert--error mb-4">{error}</p> : null}
    {monitoringUnavailable ? <p className="alert alert--warning mb-4">{text.unavailable}</p> : null}
    <input type="search" className="input-base mb-4" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.search} />
    <div className="surface-card overflow-hidden"><Table columns={columns} data={filteredRows} loading={loading} emptyMessage={text.empty} /></div>
  </section>
}

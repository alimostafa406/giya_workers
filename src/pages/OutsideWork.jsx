import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getWorkersRequest } from '../api/workersApi'
import { deleteOutsideWorkMovement, getOutsideWorkMovements, getOutsideWorkTeams, saveOutsideWorkMovement } from '../api/outsideWorkApi'
import { getErrorMessage } from '../api/axios'
import { useTranslation } from '../i18n/LanguageContext'
import { kinshasaClock } from '../utils/attendanceOperationalGate'
import { changeOutsideWorkDate, foremanKey, formatDuration, hasOutsideWorkForeman, isFinalOutsideWorkMovement, newOutsideWorkForm, outsideWorkFinalError, outsideWorkForm, weekDays, weeklyForemanReport } from '../utils/outsideWork'
import OutsideWorkEntryForm from '../components/OutsideWork/OutsideWorkEntryForm'
import WeeklyForemanRows from '../components/OutsideWork/WeeklyForemanRows'
import { getWorkerBiometricSearchIndexRequest } from '../api/biometricMappingApi'
import { biometricIdsByWorker } from '../utils/dailyOperationalReports'
import OutsideWorkMovementCard from '../components/OutsideWork/OutsideWorkMovementCard'
import { outsideWorkUiLabels } from '../components/OutsideWork/outsideWorkUiLabels'
import './OutsideWork.css'
import { outsideWorkDateLabel } from '../utils/outsideWorkDateLabels'

function WeekRange({ days, language }) {
  return <bdi dir="ltr" className="outside-work-week-context" style={{ display: 'inline-flex', gap: '.3em', alignItems: 'center' }}>
    <bdi dir={language === 'ar' ? 'rtl' : 'ltr'}>{outsideWorkDateLabel(days[0], language, true)}</bdi>{' → '}<bdi dir={language === 'ar' ? 'rtl' : 'ltr'}>{outsideWorkDateLabel(days[6], language, true)}</bdi>
  </bdi>
}

const labelSets = {
  ar: { title: 'العمل الخارجي', week: 'الأسبوع', add: 'إضافة حركة معلم', date: 'التاريخ', foreman: 'المعلم',
    foremanName: 'اسم المعلم', start: 'البداية', end: 'النهاية', workers: 'العمال', commonStart: 'بداية العمال المشتركة',
    commonEnd: 'نهاية العمال المشتركة', note: 'ملاحظة', save: 'حفظ', cancel: 'إلغاء', edit: 'تعديل', delete: 'حذف',
    show: 'عرض العمال', hide: 'إخفاء العمال', report: 'تقرير المعلم الأسبوعي', print: 'طباعة تقرير المعلم الأسبوعي',
    movementCount: 'عدد الحركات', dayCount: 'أيام العمل الخارجي', totalHours: 'إجمالي الساعات', average: 'متوسط اليوم',
    duration: 'المدة', count: 'عدد العمال', noMovements: 'لا توجد حركات لهذا اليوم', search: 'ابحث عن عامل',
    manualForeman: 'معلم غير مسجل كعامل', chooseForeman: 'اختر المعلم', chooseReport: 'اختر معلماً للتقرير',
    workerTimes: 'يمكن تعديل وقت كل عامل بعد اختياره', invalid: 'أدخل أوقاتاً صحيحة، بحيث تكون النهاية بعد البداية.',
    confirmDelete: 'حذف هذه الحركة؟', day: 'اليوم', loading: 'جاري التحميل...',
    formTitle: 'إضافة حركة عمل خارجي', editTitle: 'تعديل حركة عمل خارجي', searchForeman: 'ابحث عن معلم أجنبي',
    selectedWorkers: 'العمال المختارون', override: 'تعديل وقت عامل', removeWorker: 'إزالة العامل',
    changeForeman: 'تغيير المعلم', noMatches: 'لا توجد نتائج مطابقة', selectForemanError: 'اختر معلماً أجنبياً أو أدخل معلماً غير مسجل.',
    manualName: 'اسم المعلم غير المسجل', manualToggle: 'معلم غير مسجل' },
  en: { title: 'Outside Work', week: 'Week', add: 'Add foreman movement', date: 'Date', foreman: 'Foreman',
    foremanName: 'Foreman name', start: 'Start', end: 'End', workers: 'Workers', commonStart: 'Common worker start',
    commonEnd: 'Common worker end', note: 'Note', save: 'Save', cancel: 'Cancel', edit: 'Edit', delete: 'Delete',
    show: 'Show workers', hide: 'Hide workers', report: 'Weekly foreman report', print: 'Print Weekly Foreman Report',
    movementCount: 'Movements', dayCount: 'Outside-work days', totalHours: 'Total hours', average: 'Daily average',
    duration: 'Duration', count: 'Worker count', noMovements: 'No movements for this day', search: 'Search workers',
    manualForeman: 'Foreman not in worker list', chooseForeman: 'Select foreman', chooseReport: 'Select a foreman',
    workerTimes: 'You can override each selected worker’s times', invalid: 'Enter valid times with end after start.',
    confirmDelete: 'Delete this movement?', day: 'Day', loading: 'Loading...',
    formTitle: 'Add outside-work movement', editTitle: 'Edit outside-work movement', searchForeman: 'Search foreign foremen',
    selectedWorkers: 'Selected workers', override: 'Override worker time', removeWorker: 'Remove worker',
    changeForeman: 'Change foreman', noMatches: 'No matches', selectForemanError: 'Select a foreign foreman or enter an unregistered foreman.',
    manualName: 'Unregistered foreman name', manualToggle: 'Unregistered foreman' },
  fr: { title: 'Travail extérieur', week: 'Semaine', add: 'Ajouter un déplacement', date: 'Date', foreman: 'Chef d’équipe',
    foremanName: 'Nom du chef', start: 'Début', end: 'Fin', workers: 'Travailleurs', commonStart: 'Début commun',
    commonEnd: 'Fin commune', note: 'Note', save: 'Enregistrer', cancel: 'Annuler', edit: 'Modifier', delete: 'Supprimer',
    show: 'Afficher les travailleurs', hide: 'Masquer les travailleurs', report: 'Rapport hebdomadaire du chef',
    print: 'Imprimer le rapport hebdomadaire', movementCount: 'Déplacements', dayCount: 'Jours extérieurs',
    totalHours: 'Heures totales', average: 'Moyenne quotidienne', duration: 'Durée', count: 'Travailleurs',
    noMovements: 'Aucun déplacement ce jour', search: 'Rechercher un travailleur',
    manualForeman: 'Chef hors liste', chooseForeman: 'Choisir le chef', chooseReport: 'Choisir un chef',
    workerTimes: 'Les horaires individuels peuvent être modifiés', invalid: 'La fin doit suivre le début.',
    confirmDelete: 'Supprimer ce déplacement ?', day: 'Jour', loading: 'Chargement...',
    formTitle: 'Ajouter un déplacement extérieur', editTitle: 'Modifier le déplacement extérieur',
    searchForeman: 'Rechercher un chef étranger', selectedWorkers: 'Travailleurs sélectionnés',
    override: 'Modifier les horaires individuels', removeWorker: 'Retirer le travailleur',
    changeForeman: 'Changer de chef', noMatches: 'Aucun résultat',
    selectForemanError: 'Choisir un chef étranger ou saisir un chef non enregistré.',
    manualName: 'Nom du chef non enregistré', manualToggle: 'Chef non enregistré' },
}


const flowLabels = {
  ar: { team: 'الفريق', chooseTeam: 'اختر الفريق', teamWorkers: 'عمال الفريق', selectAll: 'اختيار كل عمال الفريق',
    deselectAll: 'إلغاء تحديد عمال الفريق', selected: 'المحددون', of: 'من', teamSearch: 'بحث داخل الفريق',
    otherSearch: 'إضافة عامل من فريق آخر', otherPlaceholder: 'اسم العامل / كود العامل / رقم البصمة',
    otherTeams: 'من فرق أخرى', missingWorker: 'عامل غير موجود', openWorkers: 'فتح صفحة العمال',
    savedBeforeWorkers: 'سيتم حفظ المسودة قبل فتح صفحة العمال. عند العودة يمكنك إكمالها.',
    saveDraft: 'حفظ كمسودة', saveFinal: 'حفظ', movements: 'الحركات', drafts: 'المسودات',
    continue: 'متابعة', updated: 'آخر تحديث', noDrafts: 'لا توجد مسودات', saved: 'تم الحفظ',
    required: 'التاريخ والفريق مطلوبان للحفظ النهائي.', unresolved: 'أكمل العامل غير الموجود أو امسح الملاحظة قبل الحفظ النهائي.',
    selectWorkers: 'اختر عاملاً حقيقياً واحداً على الأقل.', historyTimes: 'أوقات العمال المحفوظة مختلفة؛ ستبقى كما هي إلى أن تعدّل وقت العمال المشترك.' },
  en: { team: 'Team', chooseTeam: 'Select team', teamWorkers: 'Team workers', selectAll: 'Select all team workers',
    deselectAll: 'Deselect team workers', selected: 'Selected', of: 'of', teamSearch: 'Search within team',
    otherSearch: 'Add worker from another team', otherPlaceholder: 'Worker name / employee code / biometric ID',
    otherTeams: 'From other teams', missingWorker: 'Worker not found', openWorkers: 'Open Workers page',
    savedBeforeWorkers: 'Your draft is saved before opening Workers. Return to continue it.',
    saveDraft: 'Save as draft', saveFinal: 'Save', movements: 'Movements', drafts: 'Drafts',
    continue: 'Continue', updated: 'Last updated', noDrafts: 'No drafts', saved: 'Saved',
    required: 'Date and team are required for final save.', unresolved: 'Resolve or clear the missing-worker note before final save.',
    selectWorkers: 'Select at least one real worker.', historyTimes: 'Saved worker times differ; they remain unchanged until you edit the shared worker times.' },
  fr: { team: 'Équipe', chooseTeam: 'Choisir une équipe', teamWorkers: 'Travailleurs de l’équipe',
    selectAll: 'Sélectionner toute l’équipe', deselectAll: 'Désélectionner l’équipe', selected: 'Sélectionnés', of: 'sur',
    teamSearch: 'Rechercher dans l’équipe', otherSearch: 'Ajouter un travailleur d’une autre équipe',
    otherPlaceholder: 'Nom / code employé / ID biométrique', otherTeams: 'Autres équipes',
    missingWorker: 'Travailleur introuvable', openWorkers: 'Ouvrir la page Travailleurs',
    savedBeforeWorkers: 'Le brouillon sera enregistré avant l’ouverture. Revenez pour le compléter.',
    saveDraft: 'Enregistrer le brouillon', saveFinal: 'Enregistrer', movements: 'Déplacements',
    drafts: 'Brouillons', continue: 'Continuer', updated: 'Dernière modification', noDrafts: 'Aucun brouillon',
    saved: 'Enregistré', required: 'La date et l’équipe sont requises.',
    unresolved: 'Résoudre ou effacer la note du travailleur introuvable avant l’enregistrement final.',
    selectWorkers: 'Sélectionner au moins un travailleur.', historyTimes: 'Les horaires enregistrés diffèrent ; ils restent inchangés jusqu’à modification des horaires communs.' },
}

function ForemanReportSummary({ report, labels }) {
  return <div className="foreman-report-summary mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
    {[[labels.dayCount, report.dayCount], [labels.totalOvertime, formatDuration(report.totalOvertimeMinutes)], [labels.movementCount, report.movementCount]].map(([label, value]) =>
      <div key={label} className="rounded-lg border border-(--border) p-3">
        <p className="text-sm text-(--muted)">{label}</p>
        <p className="mt-1 text-lg font-bold"><bdi dir="ltr" className="inline-block whitespace-nowrap">{value}</bdi></p>
      </div>)}
  </div>
}

export default function OutsideWork() {
  const { language } = useTranslation()
  const reportLabels = {
    ar: { foremanStart: 'بداية المعلم', foremanEnd: 'نهاية المعلم', overtime: 'الوقت الإضافي', totalOvertime: 'إجمالي الوقت الإضافي للمعلم' },
    en: { foremanStart: 'Foreman Start', foremanEnd: 'Foreman End', overtime: 'Overtime', totalOvertime: 'Total foreman overtime' },
    fr: { foremanStart: 'Début du chef', foremanEnd: 'Fin du chef', overtime: 'Heures supplémentaires', totalOvertime: 'Total des heures supplémentaires du chef' },
  }
  const l = { ...(labelSets[language] || labelSets.en), ...(flowLabels[language] || flowLabels.en), ...(reportLabels[language] || reportLabels.en), ...(outsideWorkUiLabels[language] || outsideWorkUiLabels.en) }
  const [params, setParams] = useSearchParams()
  const resumeId = useRef(params.get('draft') || sessionStorage.getItem('outside_work_resume_draft'))
  const [anchor, setAnchor] = useState(() => kinshasaClock().date)
  const days = useMemo(() => weekDays(anchor), [anchor])
  const [movements, setMovements] = useState([])
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [mappings, setMappings] = useState([])
  const [form, setForm] = useState(() => newOutsideWorkForm(kinshasaClock().date))
  const [tab, setTab] = useState('movements')
  const [expanded, setExpanded] = useState([])
  const [reportForeman, setReportForeman] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const generation = useRef(0)
  const entryRef = useRef(null)
  useEffect(() => {
    if (!form?.id || tab === 'report') return
    entryRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    entryRef.current?.querySelector('h2')?.focus()
  }, [form?.id, tab])
  const load = useCallback(async () => {
    if (!days.length) return
    const current = ++generation.current
    setLoading(true)
    try {
      const [rows, roster, activeTeams, identities] = await Promise.all([
        getOutsideWorkMovements(days[0], days[6]), getWorkersRequest({ includePayrollProfiles: false }),
        getOutsideWorkTeams(), getWorkerBiometricSearchIndexRequest(),
      ])
      if (current !== generation.current) return
      setMovements(rows)
      setWorkers(roster.data || [])
      setTeams(activeTeams)
      setMappings(identities.data || [])
      setError('')
    } catch (cause) { if (current === generation.current) setError(getErrorMessage(cause)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [days])
  useEffect(() => {
    const requests = generation
    load()
    return () => { requests.current++ }
  }, [load])
  useEffect(() => {
    if (loading || !resumeId.current) return
    const draft = movements.find((row) => row.id === resumeId.current && row.status === 'draft')
    if (!draft) return
    resumeId.current = null
    sessionStorage.removeItem('outside_work_resume_draft')
    setForm({ ...outsideWorkForm(draft), team: draft.team })
    if (draft.work_date) setAnchor(draft.work_date)
    setTab('drafts')
  }, [loading, movements])
  const finals = useMemo(() => movements.filter(isFinalOutsideWorkMovement), [movements])
  const drafts = useMemo(() => movements.filter((row) => row.status === 'draft')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))), [movements])
  const foremen = useMemo(() => [...new Map(finals.filter(hasOutsideWorkForeman).map((row) => [foremanKey(row), row.foreman_name])).entries()], [finals])
  const report = useMemo(() => weeklyForemanReport(finals, reportForeman, days), [finals, reportForeman, days])
  const reportName = foremen.find(([key]) => key === reportForeman)?.[1] || ''
  const biometricIds = useMemo(() => biometricIdsByWorker(mappings), [mappings])
  const workersById = useMemo(() => new Map(workers.map((worker) => [String(worker.id), worker])), [workers])
  const teamName = (movement) => movement.team?.name || teams.find((team) => team.id === movement.team_id)?.name || '—'
  const edit = (movement) => {
    setForm({ ...outsideWorkForm(movement), team: movement.team })
    if (movement.work_date) setAnchor(movement.work_date)
    setTab(movement.status === 'draft' ? 'drafts' : 'movements')
    setError('')
    setSuccess('')
    if (movement.status === 'draft') setParams({ draft: movement.id }, { replace: true })
  }
  const save = async (status) => {
    if (busy || !form) return
    const validation = status === 'final' ? outsideWorkFinalError(form) : ''
    if (validation) { setError(l[validation]); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      const id = await saveOutsideWorkMovement({ ...form, status })
      if (!id) throw new Error('The movement could not be saved.')
      if (form.work_date && !days.includes(form.work_date)) {
        // The anchor change triggers the existing loader for the saved date's week.
        setLoading(true)
        setAnchor(form.work_date)
      } else {
        await load()
      }
      setAnchor(form.work_date || anchor)
      setForm(newOutsideWorkForm(form.work_date || anchor))
      setParams({}, { replace: true })
      sessionStorage.removeItem('outside_work_resume_draft')
      setTab(status === 'draft' ? 'drafts' : 'movements')
      setSuccess(l.saved)
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    if (busy || !window.confirm(l.confirmDelete)) return
    setBusy(true); setError('')
    try { await deleteOutsideWorkMovement(id); await load(); if (form?.id === id) setForm(newOutsideWorkForm(anchor)) }
    catch (cause) { setError(getErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  const dateLabel = (date) => outsideWorkDateLabel(date, language)
  const timestamp = (date) => date ? new Intl.DateTimeFormat(language === 'ar' ? 'ar-CD' : language,
    { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Kinshasa' }).format(new Date(date)) : '—'

  const selectedDate = form?.work_date || anchor
  const selectedMovements = finals.filter((movement) => movement.work_date === selectedDate)
  const toggleWorkers = (id) => setExpanded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const selectDate = (date) => {
    if (!date) return
    setAnchor(date)
    setForm((current) => changeOutsideWorkDate(current || newOutsideWorkForm(date), date))
  }
  return <div className="outside-work-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <style>{`@media print { @page { size: A4 portrait; margin: 14mm; }
      .app-sidebar, main > header, .outside-work-page > :not(.outside-work-print) { display: none !important; }
      main, main > div, .outside-work-page { max-width: none !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      .outside-work-print { display: block !important; position: absolute; inset: 0; width: 100%; color: #111; }
      .outside-work-print, .outside-work-print * { visibility: visible !important; }
      .outside-work-print tr { break-inside: avoid; } .outside-work-print thead { display: table-header-group; }
      .outside-work-print .foreman-report-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); break-inside: avoid; } }`}</style>
    <header className="outside-work-header"><h1>{l.title}</h1><p>{l.subtitle}</p></header>
    <div className="outside-work-control-bar">
      <label className="outside-work-date-control"><span>{tab === 'report' ? l.week : l.date}</span>
        <input aria-label={tab === 'report' ? l.week : l.date} type="date" value={tab === 'report' ? anchor : selectedDate}
          onChange={(event) => tab === 'report' ? setAnchor(event.target.value) : selectDate(event.target.value)} className="input-base" />
        <span className="outside-work-selected-date">{dateLabel(tab === 'report' ? anchor : selectedDate)}</span>
        <WeekRange days={days} language={language} />
      </label>
      <nav className="outside-work-tabs" role="tablist" aria-label={l.title}>
        <button type="button" role="tab" id="outside-work-entry-tab" aria-controls="outside-work-entry-view" aria-selected={tab !== 'report'} onClick={() => { setTab('movements'); if (form?.work_date) setAnchor(form.work_date) }}>{l.entryTab}</button>
        <button type="button" role="tab" id="outside-work-report-tab" aria-controls="outside-work-report-view" aria-selected={tab === 'report'} onClick={() => setTab('report')}>{l.reportTab}</button>
      </nav>
    </div>
    {error && <p role="alert" className="alert alert--error mb-4">{error}</p>}
    {success && <p role="status" className="mb-4 text-sm font-bold text-emerald-700">{success}</p>}
    {tab !== 'report' ? <div id="outside-work-entry-view" role="tabpanel" aria-labelledby="outside-work-entry-tab" className="outside-work-entry-layout">
      <div ref={entryRef}><OutsideWorkEntryForm key={form?.id || 'new'} value={form || newOutsideWorkForm(selectedDate)} onChange={setForm} workers={workers} teams={teams} biometricIds={biometricIds} labels={l} busy={busy || loading} showDate={false}
        onSave={save} onCancel={() => { setForm(newOutsideWorkForm(selectedDate)); setParams({}, { replace: true }); setError('') }} /></div>
      <section className="outside-work-daily-panel" aria-label={l.todayMovements}>
        <div className="outside-work-panel-heading"><div><h2>{l.todayMovements}</h2><p>{dateLabel(selectedDate)}</p></div><span className="outside-work-count">{selectedMovements.length}</span></div>
        <div className="outside-work-list-switch"><button type="button" aria-pressed={tab === 'movements'} onClick={() => setTab('movements')}>{l.movements} ({selectedMovements.length})</button>
          <button type="button" aria-pressed={tab === 'drafts'} onClick={() => setTab('drafts')}>{l.drafts} ({drafts.length})</button></div>
        {loading ? <p role="status" className="outside-work-empty">{l.loading}</p> : tab === 'drafts' ? <div className="outside-work-movement-list">
          {!drafts.length && <div className="outside-work-empty"><span aria-hidden="true">—</span><p>{l.noDrafts}</p></div>}
          {drafts.map((row) => <article key={row.id} className="outside-work-movement">
            <header className="outside-work-movement-heading"><h3><bdi>{teamName(row)}</bdi></h3><span className="outside-work-status">{l.draftBadge}</span></header>
            <p><strong><bdi>{row.foreman_name || '—'}</bdi></strong></p><p className="outside-work-caption">{dateLabel(row.work_date)} · {l.selectedWorkers}: {row.outside_work_movement_workers?.length || 0}</p>
            {row.missing_worker_note && <p className="outside-work-caption">{l.missingWorker}: {row.missing_worker_note}</p>}
            <p className="outside-work-caption">{l.updated}: {timestamp(row.updated_at)}</p>
            <footer className="outside-work-movement-actions"><button type="button" className="outside-work-text-action" onClick={() => edit(row)}>{l.continue}</button><button type="button" disabled={busy} className="outside-work-text-action outside-work-delete" onClick={() => remove(row.id)}>{l.delete}</button></footer>
          </article>)}
        </div> : <div className="outside-work-movement-list">
          {!selectedMovements.length && <div className="outside-work-empty"><span aria-hidden="true">↗</span><p>{l.noMovements}</p></div>}
          {selectedMovements.map((row) => <OutsideWorkMovementCard key={row.id} row={row} workersById={workersById} teamName={teamName(row)} labels={l} language={language} open={expanded.includes(row.id)} busy={busy}
            onToggle={() => toggleWorkers(row.id)} onEdit={() => edit(row)} onDelete={() => remove(row.id)} />)}
        </div>}
      </section>
    </div> : <section id="outside-work-report-view" role="tabpanel" aria-labelledby="outside-work-report-tab" className="outside-work-report">
      <div className="outside-work-panel-heading"><h2>{l.report}</h2></div>
      <div className="outside-work-report-toolbar"><label>{l.foreman}<select aria-label={l.chooseReport} value={reportForeman} onChange={(event) => setReportForeman(event.target.value)} className="input-base"><option value="">{l.chooseReport}</option>{foremen.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <button type="button" disabled={!report.rows.length} className="btn-secondary" onClick={() => window.print()}>{l.print}</button></div>
      {loading ? <p role="status" className="outside-work-empty">{l.loading}</p> : reportForeman ? <>
        <ForemanReportSummary report={report} labels={l} />
        <div className="outside-work-table-scroll"><table className="outside-work-compact-table"><thead><tr>{[l.day, l.date, l.foremanStart, l.foremanEnd, l.overtime, l.count, l.show].map((item) => <th key={item}>{item}</th>)}</tr></thead><tbody><WeeklyForemanRows rows={report.rows} labels={l} dateLabel={dateLabel} workersById={workersById} expanded={expanded} onToggle={toggleWorkers} /></tbody></table></div>
        {!report.rows.length && <p className="outside-work-empty">{l.noMovements}</p>}
      </> : <p className="outside-work-empty">{l.reportHint}</p>}
    </section>}
    <section className="outside-work-print hidden" aria-hidden="true"><h1>{l.report}</h1><h2>{reportName}</h2><p><WeekRange days={days} language={language} /></p>
      <table className="w-full border-collapse text-sm"><thead><tr>{[l.day, l.date, l.foremanStart, l.foremanEnd, l.overtime, l.count].map((item) => <th key={item} className="border p-2 text-start">{item}</th>)}</tr></thead><tbody><WeeklyForemanRows rows={report.rows} labels={l} dateLabel={dateLabel} workersById={workersById} print /></tbody></table>
      <ForemanReportSummary report={report} labels={l} />
    </section>

  </div>
}

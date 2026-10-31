import { isOperationalAttendanceWorkerOnDate } from './activeWorkers'
import { weeklyPayrollOvertimeForDetail } from './weeklyPayrollOvertime'
import { finalAttendanceStatus } from './finalAttendanceStatus'

export const overtimeEntryWorkers = (workers, date) => workers.filter((worker) =>
  worker.team_id && isOperationalAttendanceWorkerOnDate(worker, date))

export const parseOvertimeDuration = (value) => {
  const normalized = String(value).trim().replace(/[٠-٩۰-۹]/g, (digit) =>
    String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  const match = normalized.match(/^(\d{1,2}):([0-5]\d)$/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}
export const overtimeDuration = (minutes = 0) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
export const currentEntryOvertime = (worker, row, date) => weeklyPayrollOvertimeForDetail({ date, worker, team: worker.team, row }).eveningOvertimeMinutes

// Mirror the existing duration RPC's restrictions for visibility, not authority.
// The RPC always rechecks eligibility, payroll locks and expected_updated_at.
export const overtimeEntryBlock = (row, date, locked = false) => {
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) return 'sunday_not_eligible'
  if (locked) return 'payroll_finalized_or_paid'
  const fullPresent = row?.status === 'present' && finalAttendanceStatus(row, date) === 'present' && Number(row?.attendance_day_fraction) === 1
  const decision = row?.biometric_sync_metadata?.supervisor_morning_review?.choice
  if (['A', 'M'].includes(decision)) return 'protected_manual_attendance'
  if (!row?.id || (!fullPresent && (!row.check_in || ['absent', 'pending'].includes(row.status)))) return 'valid_check_in_required'
  // Duration-only editing never changes the protected attendance decision.
  // Canonical full-day P/O and outside-work presence do not require punches.
  if (row.manual_override === true && !row.emergency_overtime_mode && !fullPresent) return 'protected_manual_attendance'
  if (!row.updated_at) return 'attendance_changed_since_preview'
  return ''
}

export const overtimeEntryLabels = {
  ar: {
    title: 'إدخال الوقت الإضافي', subtitle: 'إضافة ساعات إضافية للعمال بسرعة حسب اليوم والفريق',
    date: 'التاريخ', week: 'أيام الأسبوع', team: 'الفريق', chooseTeam: 'اختر الفريق', search: 'بحث داخل الفريق', worker: 'العامل', code: 'كود الموظف',
    current: 'الوقت الإضافي الحالي', next: 'الوقت الجديد', selectAll: 'اختيار الكل', clear: 'إلغاء الاختيار',
    common: 'الوقت الإضافي للمختارين', apply: 'تطبيق على المختارين', selected: 'العمال المحددون', total: 'إجمالي الساعات المدخلة',
    preview: 'معاينة التعيين', save: 'حفظ الوقت الإضافي', cancel: 'إلغاء المعاينة', loading: 'جاري التحميل...', retry: 'إعادة التحميل',
    empty: 'لا يوجد عمال مطابقون', choose: 'اختر فريقاً لعرض العمال', invalid: 'اختر العمال وأدخل مدة صحيحة لكل عامل (1 دقيقة إلى 24 ساعة).',
    mode: 'تعيين الوقت الإضافي — استبدال القيمة اليدوية وليس إضافتها. لا يتم إنشاء أوقات دخول أو خروج.',
    policy: 'المدة اليدوية تستبدل الإضافي المحسوب دون تغيير البصمات أو مصدر الحضور. الحضور الكامل المعتمد لا يتطلب وقت دخول؛ تبقى قرارات الغياب والمرض وقيود الرواتب محمية.', checkout: 'خروج مسجل',
    manual: 'يدوي', biometric: 'محسوب من الحضور', updated: 'تم الحفظ', skipped: 'تم التخطي', failed: 'تعذر الحفظ',
    perWorker: 'الحفظ مستقل لكل عامل؛ قد ينجح بعض العمال ويتم تخطي آخرين. تظهر نتيجة كل عامل أدناه.',
    saving: 'جاري الحفظ...', plus30: '+30 دقيقة', hour: 'ساعة', hours: 'ساعة',
    quick: ['1 ساعة', '1:30', '2 ساعات', '3 ساعات', '4 ساعات'], applied: 'تم تطبيق المدة على المختارين',
    reasons: { payroll_finalized_or_paid: 'فترة الرواتب نهائية / مدفوعة — للقراءة فقط', valid_check_in_required: 'يلزم سجل حضور بدخول صالح',
      protected_manual_attendance: 'حضور يدوي محمي',
      attendance_changed_since_preview: 'تغير الحضور — أعد التحميل والمعاينة', sunday_not_eligible: 'الأحد غير مؤهل حسب القاعدة الحالية',
      worker_not_eligible: 'العامل غير مؤهل', already_applied: 'تم تطبيق الطلب مسبقاً', duplicate_worker: 'عامل مكرر' },
  },
  en: {
    title: 'Overtime Entry', subtitle: 'Enter worker overtime quickly by day and team', date: 'Date', week: 'Week days', team: 'Team', chooseTeam: 'Select team',
    search: 'Search within team', worker: 'Worker', code: 'Employee code', current: 'Current overtime', next: 'New duration',
    selectAll: 'Select all', clear: 'Clear selection', common: 'Overtime for selected workers', apply: 'Apply to selected', selected: 'Selected workers',
    total: 'Total entered hours', preview: 'Preview SET overtime', save: 'Save overtime', cancel: 'Cancel preview', loading: 'Loading...', retry: 'Reload',
    empty: 'No matching workers', choose: 'Select a team to show workers', invalid: 'Select workers and enter a valid duration for each (1 minute to 24 hours).',
    mode: 'SET overtime — replace the manual value, never add to it. No check-in or checkout is created.',
    policy: 'Manual duration overrides calculated overtime without changing punches or attendance source. Canonical full-day presence needs no check-in; absence/medical decisions and payroll locks remain protected.', checkout: 'Recorded checkout',
    manual: 'Manual', biometric: 'Calculated from attendance', updated: 'Saved', skipped: 'Skipped', failed: 'Failed',
    perWorker: 'Each worker is saved independently; some may succeed while others are skipped. Every result is shown below.',
    saving: 'Saving...', plus30: '+30 minutes', hour: 'hour', hours: 'hours',
    quick: ['1 hour', '1:30', '2 hours', '3 hours', '4 hours'], applied: 'Duration applied to selected workers',
    reasons: { payroll_finalized_or_paid: 'Finalized / paid payroll — read-only', valid_check_in_required: 'Valid attendance check-in required',
      protected_manual_attendance: 'Protected manual attendance',
      attendance_changed_since_preview: 'Attendance changed — reload and preview again', sunday_not_eligible: 'Sunday is not eligible under current rules',
      worker_not_eligible: 'Worker not eligible', already_applied: 'Request already applied', duplicate_worker: 'Duplicate worker' },
  },
  fr: {
    title: 'Saisie des heures supplémentaires', subtitle: 'Saisir rapidement les heures par jour et par équipe', date: 'Date', week: 'Jours de la semaine', team: 'Équipe', chooseTeam: 'Choisir une équipe',
    search: 'Rechercher dans l’équipe', worker: 'Travailleur', code: 'Code employé', current: 'Heures actuelles', next: 'Nouvelle durée',
    selectAll: 'Tout sélectionner', clear: 'Désélectionner', common: 'Durée pour la sélection', apply: 'Appliquer à la sélection', selected: 'Travailleurs sélectionnés',
    total: 'Total des heures saisies', preview: 'Vérifier le remplacement', save: 'Enregistrer les heures', cancel: 'Annuler l’aperçu', loading: 'Chargement...', retry: 'Recharger',
    empty: 'Aucun travailleur correspondant', choose: 'Choisir une équipe pour afficher les travailleurs', invalid: 'Sélectionner les travailleurs et saisir une durée valide (1 minute à 24 heures).',
    mode: 'Remplacement de la valeur manuelle, jamais un cumul. Aucune heure de pointage n’est créée.',
    policy: 'La durée manuelle remplace les heures calculées sans changer les pointages ni leur source. La présence complète validée ne requiert pas de pointage ; absence, maladie et paie verrouillée restent protégées.', checkout: 'Sortie enregistrée',
    manual: 'Manuel', biometric: 'Calculé depuis la présence', updated: 'Enregistrés', skipped: 'Ignorés', failed: 'Échecs',
    perWorker: 'Enregistrement indépendant par travailleur ; les résultats et exclusions sont détaillés ci-dessous.',
    saving: 'Enregistrement...', plus30: '+30 minutes', hour: 'heure', hours: 'heures',
    quick: ['1 heure', '1:30', '2 heures', '3 heures', '4 heures'], applied: 'Durée appliquée aux travailleurs sélectionnés',
    reasons: { payroll_finalized_or_paid: 'Paie finalisée / payée — lecture seule', valid_check_in_required: 'Entrée de présence valide requise',
      protected_manual_attendance: 'Présence manuelle protégée',
      attendance_changed_since_preview: 'Présence modifiée — recharger et vérifier', sunday_not_eligible: 'Dimanche non admissible selon les règles actuelles',
      worker_not_eligible: 'Travailleur non admissible', already_applied: 'Demande déjà appliquée', duplicate_worker: 'Travailleur en double' },
  },
}

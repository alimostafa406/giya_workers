import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { applyPayrollAdjustments, attachSundayEntitlements, calculatePayrollLine, currentBusinessDate, monthlyDailyValue, sundayBefore, weeklyDates } from './src/utils/payrollCalculations.js'

test('current week future days are neutral and contribute zero', () => {
  const worker = { id: 'worker-1' }
  const attendanceByDate = new Map([
    ['worker-1|2026-08-24', { status: 'present', check_out: '18:00:00' }],
    ['worker-1|2026-08-25', { status: 'present', check_out: '19:00:00' }],
  ])
  const line = calculatePayrollLine({
    worker,
    term: { daily_rate: 100, daily_transport_allowance: 10, overtime_rate_per_hour: 20, overtime_start_time: '17:00:00' },
    attendanceByDate,
    dates: ['2026-08-24', '2026-08-25', '2026-08-26'],
    rules: { transport_eligibility: 'present_and_half_day' },
    holidayDates: new Set(),
    paymentType: 'weekly',
    futureDatesAreNeutral: true,
    businessDate: '2026-08-24',
  })

  assert.equal(line.details[0].status, 'present')
  assert.equal(line.details[1].status, 'future')
  assert.equal(line.details[1].row, null)
  assert.equal(line.details[2].status, 'future')
  assert.equal(line.presentDays, 1)
  assert.equal(line.absentDays, 0)
  assert.equal(line.unresolvedDays, 0)
  assert.equal(line.attendanceWage, 100)
  assert.equal(line.transportAmount, 10)
  assert.equal(line.overtimeHours, 1)
  assert.equal(line.finalAmount, 130)
})

test('current workday without attendance is neutral and has no payroll effect', () => {
  const line = calculatePayrollLine({
    worker: { id: 'worker-1' },
    term: { daily_rate: 20000, daily_transport_allowance: 1000 },
    attendanceByDate: new Map(),
    dates: ['2026-08-24', '2026-08-25'],
    rules: { transport_eligibility: 'present_and_half_day' },
    holidayDates: new Set(),
    paymentType: 'weekly',
    futureDatesAreNeutral: true,
    businessDate: '2026-08-24',
  })
  assert.equal(line.details[0].status, 'not_recorded')
  assert.equal(line.details[1].status, 'future')
  assert.equal(line.absentDays, 0)
  assert.equal(line.attendanceWage, 0)
  assert.equal(line.transportAmount, 0)
  assert.equal(line.finalAmount, 0)
})

test('historical missing days keep their existing absent behavior', () => {
  const line = calculatePayrollLine({
    worker: { id: 'worker-1' },
    term: { daily_rate: 100 },
    attendanceByDate: new Map(),
    dates: ['2026-08-17', '2026-08-18'],
    rules: {},
    holidayDates: new Set(),
    paymentType: 'weekly',
    futureDatesAreNeutral: true,
    businessDate: '2026-08-24',
  })

  assert.equal(line.absentDays, 2)
  assert.deepEqual(line.details.map((detail) => detail.status), ['absent', 'absent'])
})

test('business date uses the Lagos office timezone', () => {
  assert.equal(currentBusinessDate(new Date('2026-08-23T23:30:00Z')), '2026-08-24')
})

test('weekly and monthly payroll use only explicit per-worker profile types', () => {
  const workersApi = readFileSync('./src/api/workersApi.js', 'utf8')
  const weeklyOperations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const monthlyOperations = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx', 'utf8')

  assert.match(workersApi, /payment_type: payrollProfile\?\.payment_type \|\| null/)
  assert.doesNotMatch(workersApi, /staffClassification === 'special_staff' \? 'monthly' : 'weekly'/)
  assert.match(weeklyOperations, /worker\.payment_type === 'weekly'/)
  assert.match(monthlyOperations, /worker\.payment_type === 'monthly'/)
})

test('unpaid Sunday entitlement stays visible but never changes weekly net', () => {
  const baseLine = {
    worker: { id: 'worker-1' }, currency: 'CDF', baseAmount: 60000, transportAmount: 0,
    overtimeAmount: 0, holidayAmount: 0, finalAmount: 60000,
  }
  const unpaid = { id: 'sun-1', worker_id: 'worker-1', work_date: '2026-08-23', daily_value: 10000, multiplier: 2, amount: 20000, currency_code: 'CDF', payment_status: 'unpaid', settled_payroll_run_id: null }
  const attached = attachSundayEntitlements(baseLine, [unpaid], '2026-08-29')
  assert.equal(attached.sundayPayments[0].amount, 20000)
  assert.equal(attached.finalAmount, 60000)
  assert.equal(applyPayrollAdjustments(attached).finalAmount, 60000)

  const paid = attachSundayEntitlements(baseLine, [{ ...unpaid, payment_status: 'paid' }], '2026-08-29')
  assert.equal(paid.sundayPayments[0].payment_status, 'paid')
  assert.equal(paid.finalAmount, 60000)

  const nivaExample = attachSundayEntitlements(
    { ...baseLine, baseAmount: 0, finalAmount: 0 },
    [{ ...unpaid, daily_value: 20000, amount: 40000 }],
    '2026-08-29',
  )
  assert.equal(nivaExample.sundayPayments[0].amount, 40000)
  assert.equal(nivaExample.finalAmount, 0)
})

test('Sunday is paid only by its explicit payment action, never by payroll', () => {
  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.doesNotMatch(api, /rpc\('assign_sunday_payment_to_payroll_line'/)
  assert.doesNotMatch(api, /rpc\('mark_payroll_run_paid_with_sundays'/)
  assert.match(api, /rpc\('mark_sunday_payment_paid'/)
  assert.match(operations, /await markSundayPaymentPaidRequest\(payment\.id\)[\s\S]*await load\(\)/)
  assert.match(editor, /payment\.payment_status === 'unpaid'[\s\S]*onMarkSundayPaid\(payment\)[\s\S]*sundayMarkPaid/)
  assert.match(editor, /payment\.paid_at[\s\S]*toLocaleString/)
  assert.match(sql, /payment_status = 'paid', settlement_method = 'separate', paid_at = now\(\), paid_by = auth\.uid\(\)/)
  assert.match(sql, /Intentionally do not settle Sunday entitlements here/)
  assert.match(sql, /revoke execute on function public\.assign_sunday_payment_to_payroll_line[\s\S]*from authenticated/)
})

test('paid Sunday correction is explicit, reasoned, and preserves payment audit', () => {
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  const history = readFileSync('./src/components/Payroll/SundayPaymentsPanel.jsx', 'utf8')
  const reversal = sql.slice(sql.indexOf('create or replace function public.reverse_paid_sunday_payment'), sql.indexOf('create or replace function public.mark_payroll_run_paid_with_sundays'))

  assert.match(reversal, /if not public\.is_admin\(\)/)
  assert.match(reversal, /if v_reason is null then raise exception 'A Sunday correction reason is required'/)
  assert.match(reversal, /payment_status = 'cancelled',[\s\S]*cancelled_at = now\(\),[\s\S]*cancelled_by = auth\.uid\(\),[\s\S]*cancellation_reason = v_reason/)
  assert.match(reversal, /payment_status = 'paid'[\s\S]*settlement_method = 'separate'/)
  assert.doesNotMatch(reversal, /paid_at\s*=|paid_by\s*=/)
  assert.match(sql, /payment_status = 'cancelled'[\s\S]*paid_at is not null and paid_by is not null and settlement_method = 'separate'/)
  assert.match(api, /rpc\('reverse_paid_sunday_payment',[\s\S]*p_sunday_payment_id: sundayPaymentId,[\s\S]*p_reason: normalizedReason/)
  assert.match(operations, /window\.confirm\(t\('payroll\.sundayCorrectionConfirmation'\)\)[\s\S]*window\.prompt\(t\('payroll\.sundayCorrectionReasonPrompt'\)/)
  assert.match(editor, /payment\.payment_status === 'paid'[\s\S]*onCorrectPaidSunday\(payment\)[\s\S]*sundayCorrectRegistration/)
  assert.match(history, /row\.cancellation_reason[\s\S]*row\.cancelled_at/)
})

test('monthly approved daily value is salary divided by 26', () => {
  const line = calculatePayrollLine({
    worker: { id: 'monthly-1' }, term: { monthly_salary: 260000 }, attendanceByDate: new Map(),
    dates: [], rules: { monthly_working_day_divisor: 26 }, holidayDates: new Set(), paymentType: 'monthly',
  })
  assert.equal(line.dailyValue, 10000)
  assert.equal(line.dailyValue * 2, 20000)
})

test('configured weekly rate produces exact Sunday double pay without changing normal wages', () => {
  const attendance = new Map([['weekly-1|2026-08-24', { status: 'present' }]])
  const line = calculatePayrollLine({
    worker: { id: 'weekly-1' }, term: { daily_rate: 20000 }, attendanceByDate: attendance,
    dates: weeklyDates('2026-08-24'), rules: {}, holidayDates: new Set(), paymentType: 'weekly',
    businessDate: '2026-08-29',
  })
  assert.equal(line.attendanceWage, 20000)
  assert.equal(20000 * 2, 40000)
  assert.equal(line.presentDays, 1)
})

test('Sunday RPC reuses the payroll-selected term and blocks genuinely missing compensation', () => {
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  const api = readFileSync('./src/api/payrollOperationsApi.js', 'utf8')
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  assert.match(sql, /p_compensation_term_id uuid default null/)
  assert.match(sql, /where id = p_compensation_term_id[\s\S]*worker_id = p_worker_id[\s\S]*payment_type = v_profile\.payment_type/)
  assert.match(sql, /v_daily_value := round\(v_term\.daily_rate, 2\)/)
  assert.match(sql, /round\(v_daily_value \* 2, 2\)/)
  assert.match(sql, /v_term\.monthly_salary \/ v_rule\.monthly_working_day_divisor/)
  assert.match(sql, /Worker weekly daily rate is not configured; configure payroll compensation before recording Sunday work/)
  assert.doesNotMatch(sql, /coalesce\(v_term\.daily_rate,\s*0\)|coalesce\(v_term\.monthly_salary,\s*0\)/i)
  assert.match(api, /p_compensation_term_id: compensationTermId \|\| null/)
  assert.match(operations, /compensationTermId: compensationChanged \? null : line\.term\?\.id/)
})

test('Sunday migration enforces auditability, uniqueness, and atomic settlement', () => {
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  assert.match(sql, /unique \(worker_id, work_date\)/i)
  assert.match(sql, /payment_type_snapshot text not null/i)
  assert.match(sql, /multiplier numeric\(8,4\) not null default 2 check \(multiplier = 2\)/i)
  assert.match(sql, /Future Sunday work cannot be confirmed/)
  assert.match(sql, /settled_payroll_run_id is not null and v_payment\.settled_payroll_run_id <> v_run\.id/)
  assert.match(sql, /mark_payroll_run_paid_with_sundays/)
  assert.match(sql, /payment_status = 'paid', settlement_method = 'separate'/)
  assert.doesNotMatch(sql, /where settled_payroll_run_id = p_payroll_run_id and payment_status = 'unpaid'/)
  assert.doesNotMatch(sql, /delete from public\.worker_sunday_payment/i)
})

test('worker editor week starts with the preceding Sunday and keeps Monday through Saturday unchanged', () => {
  assert.equal(sundayBefore('2026-08-24'), '2026-08-23')
  assert.deepEqual(weeklyDates('2026-08-24'), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'])
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.ok(editor.indexOf('line.sundayDate') < editor.indexOf('dates.map((date)'))
  assert.match(editor, /value=\{sundayWorked \? 'present' : 'absent'\}/)
})

test('weekly payroll table shows Sunday first from the shared Sunday payment state', () => {
  const sheet = readFileSync('./src/components/Payroll/WeeklyPayrollSheet.jsx', 'utf8')
  assert.ok(sheet.indexOf("key: 'sundayAttendance'") < sheet.indexOf('...dates.map((date)'))
  assert.match(sheet, /line\.sundayPayment && line\.sundayPayment\.payment_status !== 'cancelled'/)
  assert.match(sheet, /line\.sundayDate > currentBusinessDate\(\)/)
  assert.match(sheet, /key: 'sunday'[\s\S]*payment\?\.amount[\s\S]*sundayIndependent/)
})

test('Sunday work state stays outside normal weekly attendance wage calculation', () => {
  const result = calculatePayrollLine({
    worker: { id: 'w1' }, term: { daily_rate: 100, currency_code: 'CDF' },
    attendanceByDate: new Map(), dates: weeklyDates('2026-08-24'), rules: {},
    holidayDates: new Set(), paymentType: 'weekly', businessDate: '2026-08-29',
  })
  assert.equal(result.presentDays, 0)
  assert.equal(result.attendanceWage, 0)
  const attached = attachSundayEntitlements(result, [{ worker_id: 'w1', payment_status: 'unpaid', currency_code: 'CDF', work_date: '2026-08-23', amount: 200 }], '2026-08-29')
  assert.equal(attached.sundayPayments[0].amount, 200)
  assert.equal(attached.finalAmount, 0)
})

test('Sunday present and absent use the shared auditable payment record workflow', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const sql = readFileSync('./supabase/sql/worker_sunday_payments.sql', 'utf8')
  assert.match(operations, /confirmSundayWorkRequest\(\{[\s\S]*workerId: line\.worker\.id,[\s\S]*workDate: line\.sundayDate,[\s\S]*compensationTermId:/)
  assert.match(operations, /cancelSundayWorkRequest\(line\.sundayPayment\.id\)/)
  assert.match(sql, /payment_status in \('unpaid', 'paid', 'cancelled'\)/)
  assert.match(sql, /payment_status = 'cancelled'/)
  assert.match(sql, /payment_status = 'unpaid'[\s\S]*settled_payroll_run_id is null[\s\S]*settled_payroll_line_id is null/)
  assert.match(sql, /already been financially processed and cannot be reversed/)
  assert.match(sql, /if v_payment\.payment_status <> 'cancelled' then return v_payment/)
  assert.match(sql, /payment_status = 'unpaid',[\s\S]*cancelled_at = null/)
})

test('future Sunday is shown neutral and cannot be edited', () => {
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.match(editor, /const isFuture = line\.sundayDate > currentBusinessDate\(\)/)
  assert.match(editor, /isFuture \? <span[^>]*>—<\/span> : <select/)
})

test('monthly daily value is derived from salary and active divisor without a manual default', () => {
  assert.equal(monthlyDailyValue(600000, 26), 23076.92)
  assert.equal(monthlyDailyValue('', 26), null)
  assert.equal(monthlyDailyValue(600000, 0), null)
})

test('payroll settings require an explicit per-worker payment method before compensation fields', () => {
  const page = readFileSync('./src/pages/Payroll.jsx', 'utf8')
  assert.match(page, /payment_type: worker\.payment_type \|\| ''/)
  assert.ok(page.indexOf('<fieldset') < page.indexOf('{values.payment_type ?'))
  assert.match(page, /disabled=\{saving \|\| !values\.payment_type\}/)
  assert.match(page, /t\('payroll\.unspecified'\)/)
  assert.doesNotMatch(page, /payment_type:\s*worker\.payment_type\s*\|\|\s*'weekly'/)
})

test('weekly and monthly settings expose only their approved wage source', () => {
  const page = readFileSync('./src/pages/Payroll.jsx', 'utf8')
  assert.match(page, /values\.payment_type === 'monthly'[\s\S]*payroll\.monthlySalary[\s\S]*payroll\.derivedDailyValue/)
  assert.match(page, /monthlyDailyValue\(values\.monthly_salary, divisor\)/)
  assert.match(page, /isMonthly \?[\s\S]*payroll\.monthlySalary[\s\S]*payroll\.dailyRate/)
  assert.match(page, /latestTermForType\(worker, paymentType\)/)
})

test('settings save preserves effective-dated terms and never infers payment type from worker classification', () => {
  const api = readFileSync('./src/api/payrollSettingsApi.js', 'utf8')
  assert.match(api, /Payment type must be explicitly set to weekly or monthly/)
  assert.match(api, /onConflict: 'worker_id,effective_from'/)
  assert.match(api, /payment_type: paymentType/)
  assert.match(api, /daily_rate: paymentType === 'weekly' \? dailyRate : null/)
  assert.match(api, /monthly_salary: paymentType === 'monthly' \? monthlySalary : null/)
  assert.doesNotMatch(api, /classification|nationality|special_staff/i)
  assert.doesNotMatch(api, /\.from\('attendance'\)|\.from\('payroll_line'\)|\.delete\(\)/)
})

test('the actual weekly row edit path renders a prominent editable payment-type control', () => {
  const operations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const editor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  assert.match(operations, /import WeeklyPayrollWorkerEditPanel/)
  assert.match(operations, /<WeeklyPayrollSheet[\s\S]*onEdit=\{setEditingWorkerId\}/)
  assert.match(operations, /<WeeklyPayrollWorkerEditPanel[\s\S]*onSave=\{saveSheetEdit\}/)
  assert.ok(editor.indexOf("t('payroll.paymentType')") < editor.indexOf('dates.map((date)'))
  assert.match(editor, /\['weekly', 'monthly'\]\.map[\s\S]*onClick=\{\(\) => selectPaymentType\(type\)\}/)
  assert.match(editor, /paymentType === 'weekly' \?[\s\S]*payroll\.dailyRate[\s\S]*payroll\.monthlySalary[\s\S]*payroll\.cycleStart/)
  assert.match(editor, /paymentType === 'monthly' && derivedDailyValue/)
})

test('both weekly and monthly row editors persist a changed per-worker payment type', () => {
  const weeklyOperations = readFileSync('./src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const weeklyEditor = readFileSync('./src/components/Payroll/WeeklyPayrollWorkerEditPanel.jsx', 'utf8')
  const monthlyOperations = readFileSync('./src/components/Payroll/MonthlyPayrollOperations.jsx', 'utf8')
  assert.match(weeklyEditor, /compensation: \{ paymentType, currencyCode, dailyRate, monthlySalary, monthlyCycleStart/)
  assert.match(weeklyOperations, /selectedPaymentType = compensation\.paymentType/)
  assert.match(weeklyOperations, /saveWorkerPayrollSettingsRequest\(line\.worker, \{[\s\S]*payment_type: selectedPaymentType/)
  assert.match(monthlyOperations, /\['weekly', 'monthly'\]\.map[\s\S]*selectPaymentType\(paymentType\)/)
  assert.match(monthlyOperations, /values\.paymentType === 'weekly' \?[\s\S]*payroll\.dailyRate[\s\S]*payroll\.monthlySalary/)
  assert.match(monthlyOperations, /saveWorkerPayrollSettingsRequest\(line\.worker, \{ payment_type: values\.paymentType/)
})

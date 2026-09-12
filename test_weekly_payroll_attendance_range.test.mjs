import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('Weekly Payroll requests only the selected Monday-Saturday attendance range', () => {
  const page = fs.readFileSync('src/components/Payroll/PayrollOperations.jsx', 'utf8')
  const api = fs.readFileSync('src/api/payrollOperationsApi.js', 'utf8')
  const attendanceApi = fs.readFileSync('src/api/attendanceApi.js', 'utf8')

  assert.match(api, /getPayrollOperationsDataRequest = async \(attendanceParams = \{\}\)/)
  assert.match(api, /getAttendanceRequest\(attendanceParams\)/)
  assert.match(page, /date_from: weekStart, date_to: weeklyDates\(weekStart\)\.at\(-1\), paginate: true/)
  assert.match(attendanceApi, /query\.range\(params\.range_from, params\.range_to\)/)
  assert.match(attendanceApi, /if \(page\.length < pageSize\) return rows/)
  assert.match(page, /useEffect\(\(\) => \{ load\(monday\) \}, \[monday\]\)/)
  assert.doesNotMatch(page, /getPayrollOperationsDataRequest\(\)(?=[^\n]*setData)/)
})

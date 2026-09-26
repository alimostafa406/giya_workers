import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
test('only the settings page renders the editor; reports silently read shared settings', () => {
  for (const page of ['DailyReportsCenter', 'DailyOperationalReports']) {
    const source = readFileSync(`src/pages/${page}.jsx`, 'utf8')
    assert.doesNotMatch(source, /<OvertimeReportSettings\b/)
    assert.doesNotMatch(source, /import OvertimeReportSettings\b/)
    assert.match(source, /useOvertimeReportSettings\(/)
    assert.match(source, /overtimeTeamIds/)
  }
  const settings = readFileSync('src/pages/AttendanceOvertimeSettings.jsx', 'utf8')
  assert.match(settings, /<OvertimeReportSettings model=\{model\}/)
  assert.match(settings, /admin\?\.is_active/)
  assert.match(readFileSync('src/routes/AppRouter.jsx', 'utf8'), /path="\/settings\/attendance-overtime"/)
  assert.match(readFileSync('src/components/Sidebar/Sidebar.jsx', 'utf8'), /to: '\/settings\/attendance-overtime'/)
})

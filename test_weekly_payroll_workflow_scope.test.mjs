import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('./src/components/Payroll/PayrollOperations.jsx', import.meta.url), 'utf8')

test('weekly payroll lifecycle actions render at week level, outside team review', () => {
  const workflowStart = source.indexOf('data-weekly-payroll-workflow')
  const teamStart = source.indexOf('data-weekly-team-review')
  assert.ok(workflowStart >= 0)
  assert.ok(teamStart > workflowStart)

  const workflow = source.slice(workflowStart, teamStart)
  const teamReview = source.slice(teamStart, source.indexOf('<WeeklyPayrollWorkerEditPanel'))
  for (const action of ["changeRunStatus('reviewed')", "changeRunStatus('finalized')", "changeRunStatus('paid')"]) {
    assert.match(workflow, new RegExp(action.replace(/[()']/g, '\\$&')))
    assert.doesNotMatch(teamReview, new RegExp(action.replace(/[()']/g, '\\$&')))
  }
  assert.match(workflow, /payroll\.payrollPeriod/)
  assert.match(workflow, /calculatedLines\.length/)
  assert.match(workflow, /teamGroups\.length/)
  assert.match(workflow, /weekValidationErrors\.length/)
})

test('weekly review validates the complete current weekly worker set', () => {
  assert.match(source, /currentWeeklyWorkerIds = new Set\(calculatedLines\.map/)
  assert.match(source, /invalidCompensationLines = calculatedLines\.filter/)
  assert.match(source, /currentStoredLines = storedLines\.filter/)
  assert.match(source, /invalidAmountLines = currentStoredLines\.filter/)
  assert.match(source, /invalidCompensationLines\.map\(payrollWorkerLabel\)/)
  assert.doesNotMatch(source, /selectedTeam[^\n]*validateDraftForReview/)
})

test('finalize and payment transition the whole weekly run', () => {
  assert.match(source, /setWeeklyPayrollRunStatusRequest\(\{ runId: weeklyRun\.id, nextStatus \}\)/)
  assert.doesNotMatch(source, /setWeeklyPayrollRunStatusRequest\([^)]*team/i)
  assert.match(source, /<WeeklyPayrollTeamSummary groups=\{teamGroups\}[\s\S]*onSelectTeam=\{\(id\) => \{ setSelectedTeamId\(id\); setEditingWorkerId\(''\) \}\}/)
})

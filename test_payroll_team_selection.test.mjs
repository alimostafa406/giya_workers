import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { findPayrollTeam, payrollTeamId } from './src/utils/payrollTeamSelection.js'

const groups = [
  { id: 101, name: 'Team A', lines: [{ worker: { id: 'a' } }] },
  { id: 'team-b-uuid', name: 'Team B', lines: [{ worker: { id: 'b' } }] },
  { id: 'empty-team', name: 'Empty', lines: [] },
]

test('weekly and monthly summaries delegate navigation to the shared team cards', () => {
  for (const file of ['WeeklyPayrollTeamSummary.jsx', 'MonthlyPayrollTeamSummary.jsx']) {
    const source = readFileSync(`./src/components/Payroll/${file}`, 'utf8')
    assert.match(source, /<span className="font-extrabold">\{row\.name\}<\/span>/)
    assert.match(source, /if \(selectedTeamId\) return null/)
    assert.match(source, /return <>[\s\S]*<PayrollTeamCards groups=\{groups\} onOpenTeam=\{onSelectTeam\}[\s\S]*weekly-team-summary-wrap/)
    assert.doesNotMatch(source, /className=\{.*is-selected/)
  }
  const cards = readFileSync('./src/components/Payroll/PayrollTeamCards.jsx', 'utf8')
  assert.match(cards, /onOpenTeam\(payrollTeamId\(group\.id\)\)/)
  assert.match(cards, /min-h-36/)
  assert.match(cards, /hover:-translate-y-0\.5/)
  assert.equal(payrollTeamId(101), '101')
})

test('numeric/string and UUID IDs select the correct weekly or monthly workers', () => {
  assert.equal(findPayrollTeam(groups, '101').lines[0].worker.id, 'a')
  assert.equal(findPayrollTeam(groups, 'team-b-uuid').lines[0].worker.id, 'b')
  assert.equal(findPayrollTeam(groups, ''), null)
})

test('switching teams updates the selected detail group and empty teams remain selectable', () => {
  const first = findPayrollTeam(groups, 101)
  const second = findPayrollTeam(groups, 'team-b-uuid')
  const empty = findPayrollTeam(groups, 'empty-team')
  assert.equal(first.name, 'Team A')
  assert.equal(second.name, 'Team B')
  assert.deepEqual(empty.lines, [])
})

test('both operation parents derive detail visibility from the canonical selection helper', () => {
  for (const file of ['PayrollOperations.jsx', 'MonthlyPayrollOperations.jsx']) {
    const source = readFileSync(`./src/components/Payroll/${file}`, 'utf8')
    assert.match(source, /findPayrollTeam\(teamGroups, selectedTeamId\)/)
  }
})

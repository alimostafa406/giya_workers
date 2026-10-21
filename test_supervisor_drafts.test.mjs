import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initialSupervisorChoices } from './src/utils/supervisorMorningReview.js'

test('45 unresolved worker IDs default to form-only A', () => {
  const ids = Array.from({ length: 45 }, (_, i) => String(i))
  const choices = initialSupervisorChoices(ids)
  assert.equal(Object.keys(choices).length, 45)
  assert.deepEqual(new Set(Object.values(choices)), new Set(['A']))
})
test('official decisions take precedence, then draft, then A; nonpopulation IDs never leak', () => {
  const official = { a: 'P', b: 'O', c: 'M', d: 'A' }, draft = { a: 'M', b: 'A', c: 'P', d: 'P', e: 'O', extra: 'P' }
  const before = JSON.stringify([official, draft])
  assert.deepEqual(initialSupervisorChoices(['a','b','c','d','e','f'], official, draft), { a: 'P', b: 'O', c: 'M', d: 'A', e: 'O', f: 'A' })
  assert.equal(JSON.stringify([official, draft]), before)
})
test('form uses versioned draft RPC and saves draft before official submit', () => {
  const api = readFileSync('src/api/supervisorMorningReviewApi.js', 'utf8')
  assert.match(api, /'admin_supervisor_review_draft'/)
  for (const parameter of ['p_snapshot_token', 'p_revision', 'p_official_token']) assert.ok(api.includes(parameter))
  const page = readFileSync('src/pages/SupervisorSheet.jsx', 'utf8')
  assert.match(page, /const context = await persistDraft\(\)[\s\S]*await submitSupervisorDraftRequest/)
  assert.doesNotMatch(page, /\.from\(['"]attendance|localStorage\.setItem/)
})

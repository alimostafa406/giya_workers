# FINAL Outside Work and supervisor review

Open/draft supervisor reviews project the immutable population snapshot into an actionable roster. The existing private.outside_work_evidence_ids(worker,date) resolver determines authoritative FINAL Outside Work; these workers need no supervisor choice. No movement, worker, attendance, team, payroll, or snapshot data is migrated.

The active roster determines draft tokens, validation and missing-choice counts. Load filters stale draft choices without writing them. A pre-Outside-Work submit token fails with 40001. Saving the refreshed draft removes excluded choices; final submission writes only remaining workers. The protected writer also ignores stale client choices for authoritative FINAL Outside Work and retains payroll locks and unrelated manual-conflict protection. An all-Outside-Work sheet can finalize with zero decisions.

Newly finalized sheets retain the actual submitted roster through their stored result keys. Existing finalized drafts keep their original keys; pre-draft completed historical and payroll-locked views retain their original population. Snapshot rows remain immutable. Finalized drafts cannot be reopened through save.

The UI checks draft context every 15 seconds and on focus while open, fetching the roster only when its token changes. Safe Outside Work-only removals preserve other unsaved choices; competing revisions require reload. Completed sheets stop polling and are read-only.

Production verification: 2026-11-25 has a 52-worker stored snapshot. GRADI1 #99 and PEMBELE #24 have authoritative FINAL Outside Work; both are absent from the 50-worker active review. Their present/outside_work attendance, permanent teams and payable evidence remain unchanged. No production supervisor sheet was submitted for testing. Rollback-only fixtures prove normal submission without excluded workers, stale A protection, unrelated protected M rollback, immutable finalized rosters and zero-choice submission.

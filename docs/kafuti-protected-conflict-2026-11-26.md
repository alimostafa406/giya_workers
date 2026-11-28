# KAFUTI conflict audit

Read-only production audit, 2026-11-28. Worker KAFUTI #95, d5a3617f-0b81-448c-82af-2e0925380698, permanent team Saleh Menuisier.

For work date 2026-11-26: attendance is absent, fraction 0, source manual, manual_override=true, with null check-in/out. Supervisor-origin choice A was finalized on 2026-11-27; saved sheet revision 2 also records A. A matches A and is not itself a supervisor-choice conflict.

FINAL Outside Work movement 4cf2fc2e-e9bf-4763-92e9-dac297382511 asserts Outside Work presence (O), 08:00-17:00, foreman SALEH MENUISIER. Its protected-conflict evidence was recorded on 2026-11-28. This O evidence conflicts with the protected A. One actual biometric event exists: office-main exact ID 06397410, 17:59:43 Kinshasa. That event does not authorize overwriting protected manual absence.

Only diagnostics changed. The existing authorized draft response now includes exact protected and supervisor values plus Outside Work conflict context. Submit protection predicates and canonical A/P/O/M semantic helper remain unchanged; rejection errors now include structured detail. The supervisor UI displays both choices and explains when they match each other but conflict with FINAL Outside Work. No automatic resolution or attendance writes were performed.

Before/after protected attendance checksum: fd1eddbe01952b8d7a753e469e3f3032. SQL fixture changes roll back. Rendering tests cover Arabic A/A versus Outside Work O and failed A/P finalization with draft preservation.

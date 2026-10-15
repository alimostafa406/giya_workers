"""Night-window regressions; synthetic evidence only, no writes."""
import unittest
from datetime import date
from pathlib import Path
from hikvision_attendance_sync import plan_attendance, impacted_previous_workdays, biometric_payload
from hikvision_attendance_agent import late_tail_reconciliation_plans
from test_attendance_sync_planning import resolution_with, attendance_event, WORKER_ID
import test_attendance_final_verification as verification_fixtures
from hikvision_attendance_verification import completed_morning_snapshot_compatibility, morning_verification_targets

D = date(2026, 10, 14)

class NightShiftTests(unittest.TestCase):
    def test_schema_defaults_and_future_early_review_guard(self):
        root = Path(__file__).parent / 'supabase' / 'migrations'
        schema = (root / '20261014163559_worker_attendance_shift.sql').read_text(encoding='utf-8')
        review = (root / '20261015072720_night_shift_early_review.sql').read_text(encoding='utf-8')
        self.assertIn("not null default 'day'", schema)
        self.assertIn("attendance_shift in ('day','night')", schema)
        self.assertIn("w.id=new.worker_id and w.attendance_shift='night'", review)
        self.assertIn("<> 'chauffeur'", review)
        self.assertLess(review.index('return new;'), review.index('insert into'))
        self.assertNotIn('update public.biometric_early_morning_review', review)

    def test_shift_change_preserves_completed_morning_snapshot(self):
        resolution = verification_fixtures.base_resolution()
        resolution['workers']['w1']['attendance_shift'] = 'night'
        run = verification_fixtures.FinalMorningVerificationTests.completed_run()
        before = dict(run)
        result = completed_morning_snapshot_compatibility(run, resolution, [verification_fixtures.DEVICE_MAIN, verification_fixtures.DEVICE_SECONDARY])
        self.assertTrue(result['compatible'])
        self.assertEqual(run, before)
        self.assertNotIn('w1', morning_verification_targets(resolution))

    def resolution(self, shift='night'):
        result = resolution_with(None)
        result['workers'][WORKER_ID]['attendance_shift'] = shift
        return result

    def event(self, clock, next_day=False, serial=1):
        return attendance_event(clock, event_date='2026-10-15' if next_day else D.isoformat(), serial=serial)

    def plan(self, events):
        plans, counters = plan_attendance(events, self.resolution(), D)
        return plans[0], counters

    def test_single_real_evening_event_present_without_fake_checkout(self):
        plan, _ = self.plan([self.event('17:00:00')])
        self.assertEqual(plan['proposed_status'], 'present')
        self.assertEqual(plan['check_in'], '17:00:00')
        self.assertIsNone(plan['check_out'])

    def test_real_earliest_and_latest_across_midnight_inclusive(self):
        plan, _ = self.plan([self.event('18:02:12'), self.event('00:31:00', True, 2), self.event('06:30:00', True, 3)])
        self.assertEqual(plan['check_in'], '18:02:12')
        self.assertEqual(plan['check_out'], '06:30:00')
        self.assertTrue(plan['check_out_next_day'])
        self.assertEqual(plan['proposed_status'], 'present')

    def test_post_midnight_only_event_is_previous_night_arrival(self):
        event = self.event('05:30:00', True)
        plan, _ = self.plan([event])
        self.assertEqual(plan['check_in'], '05:30:00')
        self.assertIsNone(plan['check_out'])
        self.assertEqual(plan['proposed_status'], 'present')
        self.assertEqual(late_tail_reconciliation_plans([plan], {WORKER_ID}), [plan])
        next_plans, _ = plan_attendance([event], self.resolution(), date(2026, 10, 15))
        self.assertTrue(all(not item.get('check_in') for item in next_plans))
        impacted = impacted_previous_workdays([event], self.resolution(), date(2026, 10, 15))
        self.assertIn(WORKER_ID, impacted[D])

    def test_outside_night_window_not_evidence(self):
        plan, counters = self.plan([self.event('16:59:59'), self.event('06:30:01', True)])
        self.assertIsNone(plan['check_in'])
        self.assertEqual(counters['outside_night_window'], 2)

    def test_day_worker_tail_not_extended(self):
        event = self.event('05:30:00', True)
        self.assertEqual(impacted_previous_workdays([event], self.resolution('day'), date(2026, 10, 15)), {})

    def test_sunday_night_window_does_not_change_day_calendar(self):
        sunday = date(2026, 10, 18)
        event = attendance_event('18:10:00', event_date=sunday.isoformat())
        night, _ = plan_attendance([event], self.resolution(), sunday)
        day, _ = plan_attendance([event], self.resolution('day'), sunday)
        self.assertEqual(night[0]['proposed_status'], 'present')
        self.assertEqual(day[0]['proposed_status'], 'non_working_day')

    def test_chauffeur_calendar_rule_remains_unchanged(self):
        resolution = self.resolution('day')
        resolution['workers'][WORKER_ID]['team_id'] = 'chauffeur'
        resolution['teams']['chauffeur'] = {'name': 'Chauffeur'}
        plans, _ = plan_attendance([self.event('08:00:00')], resolution, D)
        self.assertEqual(plans[0]['proposed_status'], 'present')
        self.assertFalse(plans[0]['night_shift'])

    def test_explicit_night_chauffeur_uses_night_window(self):
        resolution = self.resolution()
        resolution['workers'][WORKER_ID]['team_id'] = 'chauffeur'
        resolution['teams']['chauffeur'] = {'name': 'Chauffeur'}
        plans, _ = plan_attendance([self.event('18:00:00'), self.event('05:30:00', True, 2)], resolution, D)
        self.assertTrue(plans[0]['night_shift'])
        self.assertEqual(plans[0]['check_in'], '18:00:00')
        self.assertEqual(plans[0]['check_out'], '05:30:00')

    def test_october_12_night_payload_remains_full_present(self):
        day = date(2026, 10, 12)
        plans, _ = plan_attendance([attendance_event('17:29:46', event_date=day.isoformat())], self.resolution(), day)
        payload = biometric_payload(plans[0], None)
        self.assertEqual(payload['status'], 'present')
        self.assertEqual(payload['attendance_day_fraction'], 1.0)
        self.assertIsNone(payload['check_out'])
        self.assertFalse(payload['manual_override'])

    def test_night_event_not_marked_early_morning_review(self):
        plan, counters = self.plan([self.event('04:00:00', True)])
        self.assertEqual(counters['early_morning_needs_review'], 0)
        self.assertEqual(plan['proposed_status'], 'present')

if __name__ == '__main__':
    unittest.main()

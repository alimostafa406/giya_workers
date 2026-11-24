import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {sundayReportRows,sundayReportTotals} from './sundayPayroll'
import {weeklyPayrollOvertimeForDetail} from './weeklyPayrollOvertime'
const date='2026-11-22'
it.skipIf(!process.env.SUNDAY_REPORT_AUDIT)('real November 22 report keeps NIOKA payable and flags genuinely missing monthly salaries',()=>{
 const source=JSON.parse(readFileSync(process.env.SUNDAY_REPORT_AUDIT,'utf8')),before=JSON.stringify(source)
 const rows=sundayReportRows(source,date)
 expect(rows).toHaveLength(53)
 expect(rows.find(r=>r.worker.employee_code==='179')).toMatchObject({present:true,daily:25000,amount:50000,overtimeMinutes:0,netAmount:50000})
 expect(rows.find(r=>r.worker.employee_code==='71')).toMatchObject({present:false,daily:null,amount:0,overtimeMinutes:0,canConfirm:false})
 expect(rows.find(r=>r.worker.employee_code==='300')).toMatchObject({present:true,daily:null,amount:null,overtimeMinutes:0,canConfirm:false})
 expect(JSON.stringify(source)).toBe(before)
})
function data(decision='approved'){
 const worker={id:'w',is_active:true,team_id:'t',team_name:'Peinture',payment_type:'weekly',payroll_compensation_terms:[{payment_type:'weekly',effective_from:'2026-01-01',daily_rate:20000,overtime_rate_per_hour:3000,currency_code:'CDF'}]}
 const attendance={id:'a',worker_id:'w',attendance_date:date,status:'present',attendance_source:'biometric',check_in:'08:05:00',check_out:'19:01:00'}
 return {date,workers:[worker],attendance:[attendance],sunday_evidence:[{worker_id:'w',eligible:true,punch_count:6,checkout:'19:01:00'}],biometricOvertimeReviews:[{worker,attendance,source_fingerprint:'f',review:{decision,minutes:301,source_fingerprint:'f'}}]}
}
it.each([['14:05:00',0],['14:30:00',0],['14:30:01',30],['14:31:00',31],['19:01:00',301]])('Sunday %s uses shared strict threshold and real minutes', (check_out,minutes)=>{
 expect(weeklyPayrollOvertimeForDetail({date,row:{check_out}}).eveningOvertimeMinutes).toBe(minutes)
})
it('separates Sunday double base and approved hourly OT, sums each exactly once',()=>{
 const rows=sundayReportRows(data(),date)
 expect(rows[0]).toMatchObject({amount:40000,overtimeMinutes:301,overtimeAmount:15050,netAmount:55050})
 expect(sundayReportTotals(rows)).toMatchObject({baseCurrencies:{CDF:40000},overtimeCurrencies:{CDF:15050},currencies:{CDF:55050},overtimeMinutes:301})
})
it.each(['pending','rejected'])('%s OT stays non-payable while Sunday base remains',decision=>{
 expect(sundayReportRows(data(decision),date)[0]).toMatchObject({amount:40000,overtimeMinutes:0,overtimeAmount:0,netAmount:40000,candidateMinutes:301})
})
it('stale evidence does not pay and adjusted approved minutes are respected',()=>{
 const d=data();d.biometricOvertimeReviews[0].review.source_fingerprint='old'
 expect(sundayReportRows(d,date)[0].overtimeMinutes).toBe(0)
 const adjusted=data();adjusted.biometricOvertimeReviews[0].review.minutes=60
 adjusted.biometricOvertimeReviews[0].review.history=[{source_fingerprint:'f',minutes:60,original_biometric_minutes:301}]
 expect(sundayReportRows(adjusted,date)[0]).toMatchObject({overtimeMinutes:60,overtimeAmount:3000,netAmount:43000})
})
it('approved Sunday evidence suggestions stay non-payable until explicit reapproval, then pay once',()=>{
 const d=data();const s=d.biometricOvertimeReviews[0]
 Object.assign(s,{sunday_evidence:true,raw_minutes:301,source_fingerprint:'edited',suggested_approved_minutes:270,approved_evidence_valid:true,approved_evidence:{approved_first_punch:'2026-11-22T07:00:00Z'}})
 expect(sundayReportRows(d,date)[0]).toMatchObject({overtimeMinutes:0,displayOvertimeMinutes:270,netAmount:40000})
 s.review={decision:'approved',minutes:255,source_fingerprint:'edited',version:2,history:[{source_fingerprint:'edited',minutes:255,original_biometric_minutes:301}]}
 expect(sundayReportRows(d,date)[0]).toMatchObject({overtimeMinutes:255,displayOvertimeMinutes:255,overtimeAmount:12750,netAmount:52750})
 expect(s.raw_minutes).toBe(301)
})
it('a recurring preference cannot bypass the canonical pending OT decision',()=>{
 const d=data('pending');d.biometricOvertimeReviews[0].sunday_evidence=true;d.biometricOvertimeReviews[0].raw_minutes=301;d.biometricOvertimeReviews[0].sunday_settings={overtime_requires_approval:false}
 expect(sundayReportRows(d,date)[0]).toMatchObject({overtimeMinutes:0,overtimeAmount:0,netAmount:40000})
})
it('does not invent a 14:00 candidate when a custom later OT start excludes it canonically',()=>{
 const d=data();d.biometricOvertimeReviews=[];d.sunday_evidence[0].checkout='14:45:00';d.sunday_evidence[0].sunday_settings={custom:true,overtime_start:'15:00:00'}
 expect(sundayReportRows(d,date)[0]).toMatchObject({candidateMinutes:0,overtimeMinutes:0,overtimeAmount:0})
})
it('manual duration wins without duplicating approved biometric OT; Chauffeur stays manual-only',()=>{
 const d=data();Object.assign(d.attendance[0],{manual_override:true,emergency_overtime_mode:'manual_overtime_duration',emergency_overtime_minutes:120})
 expect(sundayReportRows(d,date)[0]).toMatchObject({overtimeMinutes:120,overtimeAmount:6000,netAmount:46000})
 d.workers[0].team_name='Chauffeur';expect(sundayReportRows(d,date)[0].overtimeMinutes).toBe(120)
 delete d.attendance[0].manual_override;expect(sundayReportRows(d,date)[0]).toMatchObject({overtimeMinutes:0,candidateMinutes:0})
})
it('weekday end remains 17:00 and Saturday automatic OT remains excluded',()=>{
 expect(weeklyPayrollOvertimeForDetail({date:'2026-11-20',row:{check_out:'17:55:19'}}).eveningOvertimeMinutes).toBe(55)
 expect(weeklyPayrollOvertimeForDetail({date:'2026-11-21',row:{check_out:'19:01:00'}}).eveningOvertimeMinutes).toBe(0)
})

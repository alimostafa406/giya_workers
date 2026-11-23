import { describe, expect, it } from 'vitest'
import { applyWeeklySundayPay, isSundayDate, latestSunday, sundayReportRows, sundayTeamGroups, sundayReportTotals } from './sundayPayroll'
import {readFileSync} from 'node:fs'

const date='2026-10-18'
const fixture=payment_type=>({date,sunday_evidence:[{worker_id:'w',eligible:true,reason:'eligible',punch_count:2,morning:'07:05:00',checkout:'14:03:00'}],rules:{monthly_working_day_divisor:26},workers:[{id:'w',payment_type,is_active:false,payroll_compensation_terms:[{payment_type,effective_from:'2026-01-01',daily_rate:20000,monthly_salary:520000,currency_code:'CDF'}]}],attendance:[{worker_id:'w',attendance_date:date,status:'present',attendance_day_fraction:1,attendance_source:'outside_work',check_in:null,check_out:null}]})
describe('Sunday canonical report',()=>{
 it('uses the effective recurring multiplier but keeps an existing Sunday ledger frozen',()=>{
  const data=fixture('weekly');data.sunday_evidence[0].sunday_settings={pay_multiplier:3}
  expect(sundayReportRows(data,date)[0]).toMatchObject({daily:20000,multiplier:3,amount:60000})
  data.payments=[{worker_id:'w',work_date:date,payment_status:'unpaid',daily_value:20000,multiplier:2,amount:40000,currency_code:'CDF'}]
  expect(sundayReportRows(data,date)[0]).toMatchObject({multiplier:2,amount:40000})
 })
 it('uses monthly salary / canonical divisor for Sunday even with six punches, independent of weekly zero base',()=>{
  const data=fixture('monthly');data.sunday_evidence[0]={worker_id:'w',eligible:true,punch_count:6,morning:'09:05:04',checkout:'19:01:16'}
  expect(sundayReportRows(data,date)[0]).toMatchObject({present:true,punchCount:6,daily:20000,amount:40000,canConfirm:true})
 })
 it.each([0,null])('flags missing monthly salary %s instead of offering a zero-wage Sunday approval',salary=>{
  const data=fixture('monthly');data.workers[0].payroll_compensation_terms[0].monthly_salary=salary
  expect(sundayReportRows(data,date)[0]).toMatchObject({present:true,daily:null,amount:null,canConfirm:false})
 })
 it('hides roster-only absences and empty teams, but keeps authorized manual Sunday presence without fake punches',()=>{
  const data=fixture('weekly');data.sunday_evidence=[{worker_id:'w',punch_count:0,eligible:false}];data.attendance[0]={worker_id:'w',attendance_date:date,status:'absent'}
  expect(sundayReportRows(data,date)).toEqual([]);expect(sundayTeamGroups(sundayReportRows(data,date))).toEqual([])
  Object.assign(data.attendance[0],{status:'present',attendance_day_fraction:1,manual_override:true,attendance_source:'manual'});data.sunday_evidence[0]={worker_id:'w',punch_count:0,eligible:true,manual:true,reason:'manual',display_check_in:null,display_check_out:null}
  expect(sundayReportRows(data,date)[0]).toMatchObject({present:true,punchCount:0,amount:40000})
 })
 it.skipIf(!process.env.SUNDAY_TEAM_AUDIT)('real August 23 Sunday groups only 52 safe attendees; incomplete punches never earn automatic Sunday pay',()=>{
  const data=JSON.parse(readFileSync(process.env.SUNDAY_TEAM_AUDIT,'utf8')),before=JSON.stringify(data),rows=sundayReportRows(data,data.date),totals=sundayReportTotals(rows),groups=sundayTeamGroups(rows)
  expect(totals).toMatchObject({workers:52,onePunch:32,twoPunch:20,present:6});expect(groups.every(g=>g.rows.length>0)).toBe(true);expect(groups.reduce((s,g)=>s+g.totals.workers,0)).toBe(52)
  for(const row of rows){expect(row.punchCount).toBeGreaterThan(0);if(!row.present)expect(row.amount).toBe(0);else if(row.daily!=null)expect(row.amount).toBe(Math.round(row.daily*2*100)/100)}
  expect(rows.find(r=>r.worker.employee_code==='122')).toMatchObject({punchCount:1,present:false,amount:0})
  expect(rows.find(r=>r.worker.employee_code==='161')).toMatchObject({punchCount:2,present:true})
  expect(JSON.stringify(data)).toBe(before)
 })
 for(const type of ['weekly','monthly']) for(const reason of ['missing_in','missing_out','ineligible']) it(`${type}: ${reason} is visible but never present or payable`,()=>{const data=fixture(type);data.sunday_evidence=[{worker_id:'w',eligible:false,reason,punch_count:1,morning:reason==='missing_out'?'07:05:00':null,checkout:reason==='missing_in'?'14:05:00':null}];data.payments=[{worker_id:'w',work_date:date,payment_status:'unpaid',daily_value:20000,multiplier:2,amount:40000,currency_code:'CDF'}];expect(sundayReportRows(data,date)[0]).toMatchObject({present:false,amount:0,canConfirm:false});expect(data.payments[0].amount).toBe(40000)})
 it('fails closed without the canonical backend eligibility result',()=>{const data=fixture('weekly');delete data.sunday_evidence;expect(sundayReportRows(data,date)[0]).toMatchObject({present:false,amount:0,canConfirm:false})})
 it('uses calendar Sundays only',()=>{expect(isSundayDate(date)).toBe(true);expect(isSundayDate('2026-10-19')).toBe(false);expect(latestSunday('2026-10-22')).toBe(date);expect(sundayReportRows(fixture('weekly'),'2026-10-19')).toEqual([])})
 for(const type of ['weekly','monthly'])it(`${type}: resolves canonical daily wage and doubles it without inventing punches`,()=>{const [r]=sundayReportRows(fixture(type),date);expect(r.daily).toBe(20000);expect(r.amount).toBe(40000);expect(r.canConfirm).toBe(true);expect(r.attendance.check_in).toBeNull();expect(r.attendance.check_out).toBeNull()})
 it('preserves authoritative historical manual payments and frozen wages',()=>{const data=fixture('weekly');data.attendance=[];data.payments=[{worker_id:'w',work_date:date,payment_status:'unpaid',daily_value:17500,multiplier:2,amount:35000,currency_code:'CDF'}];expect(sundayReportRows(data,date)[0]).toMatchObject({daily:17500,amount:35000,canConfirm:false})})
 it('does not turn protected absence into Sunday work',()=>{const data=fixture('weekly');Object.assign(data.attendance[0],{status:'absent',manual_override:true});expect(sundayReportRows(data,date)[0]).toMatchObject({present:false,amount:0,canConfirm:false})})
 it('adds unpaid Sunday once, excluding paid, cancelled, wrong-week and reserved payments',()=>{const line={worker:{id:'w'},currency:'CDF',bonusAmount:10,finalAmount:100};const p={id:'p',worker_id:'w',work_date:date,payment_status:'unpaid',amount:40000,currency_code:'CDF'};const data={sundayPayments:[p,p,{...p,id:'paid',payment_status:'paid'},{...p,id:'cancelled',payment_status:'cancelled'},{...p,id:'reserved',settled_payroll_run_id:'other'},{...p,id:'other-date',work_date:'2026-10-11'}]};const once=applyWeeklySundayPay(line,data,'2026-10-19');expect(once.sundayPayments).toHaveLength(1);expect(once.finalAmount).toBe(40100);expect(once.bonusAmount).toBe(40010);expect(applyWeeklySundayPay(once,data,'2026-10-19')).toEqual(once);expect(applyWeeklySundayPay(line,{sundayPayments:[{...p,payroll_eligible:false}]},'2026-10-19').finalAmount).toBe(100)})
})

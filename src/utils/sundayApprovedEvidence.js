// Kinshasa is UTC+01:00 without seasonal clock changes. Keep the work date
// explicit; 00:00–02:00 is the following calendar day in Sunday's window.
import {parseWeeklyDuration} from './weeklyManualOvertime'
export function approvedSundayClock(row,key){
 const value=row.approved_evidence_valid&&row.approved_evidence?.[`approved_${key}_punch`]||row.evidence?.[`${key}_at`]
 return value?new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kinshasa',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):''
}
export function sundayInlineDraft(row,date,key,value,draft={}){
 const next={...draft,[key]:value}
 if(key!=='duration'){
  const minutes=suggestedSundayMinutes(date,next.first??approvedSundayClock(row,'first'),next.last??approvedSundayClock(row,'last'),row.sunday_settings?.overtime_start)
  next.duration=minutes==null?'':`${Math.floor(minutes/60)}h${String(minutes%60).padStart(2,'0')}`
 }
 return next
}
export function sundayInlinePayload(row,date,draft){
 const first=sundayEvidenceTimestamp(date,draft.first??approvedSundayClock(row,'first')),last=sundayEvidenceTimestamp(date,draft.last??approvedSundayClock(row,'last'))
 const text=draft.duration??`${Math.floor(row.approvedMinutes/60)}h${String(row.approvedMinutes%60).padStart(2,'0')}`
 const min=text.trim().match(/^(\d+)\s*min$/i),minutes=min?Number(min[1]):parseWeeklyDuration(text.trim().replace('h',':'))
 if(!first||!last||new Date(first)>=new Date(last)||!Number.isInteger(minutes)||minutes<0||minutes>1440)throw new Error('أدخل أوقاتاً صحيحة بنظام 24 ساعة ومدة إضافي صحيحة')
 return {first,last,minutes,note:draft.note||''}
}
export function sundayEvidenceTimestamp(date,clock){
 if(/^\d{1,2}$/.test(clock||'')&&Number(clock)<=23)clock=String(clock).padStart(2,'0')+':00:00'
 if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock||''))return null
 const normalized=clock.length===5?clock+':00':clock
 let day=date
 if(normalized<='02:00:00'){
  const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10)
 }
 return `${day}T${normalized}+01:00`
}
export function suggestedSundayMinutes(date,first,last,start='14:00:00'){
 const a=sundayEvidenceTimestamp(date,first),b=sundayEvidenceTimestamp(date,last)
 if(!a||!b||new Date(a)>=new Date(b))return null
 const end=new Date(b),otStart=new Date(`${date}T${start.length===5?start+':00':start}+01:00`)
 const seconds=(end-otStart)/1000
 return seconds>1800?Math.floor(seconds/60):0
}

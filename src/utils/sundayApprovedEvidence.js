// Kinshasa is UTC+01:00 without seasonal clock changes. Keep the work date
// explicit; 00:00–02:00 is the following calendar day in Sunday's window.
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

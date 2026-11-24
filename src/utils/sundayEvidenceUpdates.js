const key='workers_sunday_evidence_updated'
export function notifySundayEvidenceUpdate(date){
 if(typeof window==='undefined')return
 try{window.localStorage.setItem(key,JSON.stringify({date,changedAt:Date.now(),nonce:Math.random()}))}catch{/* A blocked browser store must not fail a saved decision. */}
}
export function subscribeSundayEvidenceUpdates(date,onChange){
 if(typeof window==='undefined')return()=>{}
 const receive=event=>{if(event.key!==key||!event.newValue)return;try{if(JSON.parse(event.newValue).date===date)onChange()}catch{/* Ignore malformed notifications. */}}
 window.addEventListener('storage',receive)
 return()=>window.removeEventListener('storage',receive)
}

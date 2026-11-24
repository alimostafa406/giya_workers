import {useRef,useState} from 'react'

export default function SundayInlineValue({label,value,disabled,onSave}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value),[saving,setSaving]=useState(false)
 const busy=useRef(false)
 const save=async()=>{
  if(busy.current||disabled)return
  if(draft===value){setEditing(false);return}
  busy.current=true;setSaving(true)
  try{if(await onSave(draft))setEditing(false)}finally{busy.current=false;setSaving(false)}
 }
 return editing?<span className="sunday-inline-editor"><input autoFocus className="input-base" dir="ltr" aria-label={label} value={draft} disabled={saving||disabled}
  title="Enter للحفظ · Esc للإلغاء" onChange={e=>setDraft(e.target.value)}
  onBlur={()=>{if(!busy.current)setEditing(false)}} onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();if(!busy.current)setEditing(false)}
   if(e.key==='Enter'){e.preventDefault();void save()}
  }}/>{saving&&<small role="status">جاري الحفظ...</small>}</span>
  :<button type="button" className="sunday-inline-value" aria-label={label} data-value={value} title="اضغط للتعديل · Enter للحفظ · Esc للإلغاء" disabled={disabled} onClick={()=>{setDraft(value);setEditing(true)}}><bdi dir="ltr">{value}</bdi></button>
}

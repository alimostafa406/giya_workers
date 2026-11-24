// @vitest-environment jsdom
import {expect,it,vi} from 'vitest'
import {notifySundayEvidenceUpdate,subscribeSundayEvidenceUpdates} from './sundayEvidenceUpdates'
it('notifies other open Sunday pages for the same date without polling',()=>{
 const changed=vi.fn(),stop=subscribeSundayEvidenceUpdates('2026-11-22',changed)
 notifySundayEvidenceUpdate('2026-11-22')
 const key='workers_sunday_evidence_updated',newValue=localStorage.getItem(key)
 expect(JSON.parse(newValue).date).toBe('2026-11-22')
 window.dispatchEvent(new StorageEvent('storage',{key,newValue}));expect(changed).toHaveBeenCalledOnce()
 window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify({date:'2026-11-15'})}));expect(changed).toHaveBeenCalledOnce()
 stop();window.dispatchEvent(new StorageEvent('storage',{key,newValue}));expect(changed).toHaveBeenCalledOnce()
})

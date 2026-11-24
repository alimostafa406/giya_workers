// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import SundayInlineValue from './SundayInlineValue'
globalThis.React=React
afterEach(cleanup)
it('opening a shortened display without changes does not save and an open edit retains its original version context',async()=>{
 const oldSave=vi.fn().mockResolvedValue(true),newSave=vi.fn()
 const view=render(<SundayInlineValue label="Clock" value="08:28" editValue="08:28:38" onSave={oldSave}/>)
 fireEvent.click(screen.getByRole('button'));fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'})
 expect(oldSave).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button'));fireEvent.change(screen.getByRole('textbox'),{target:{value:'08:05'}})
 view.rerender(<SundayInlineValue label="Clock" value="08:30" editValue="08:30:00" onSave={newSave}/>)
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'})
 await waitFor(()=>expect(oldSave).toHaveBeenCalledWith('08:05'));expect(newSave).not.toHaveBeenCalled()
})
it('click edits, Escape cancels, Enter saves once and returns to text',async()=>{
 let complete;const save=vi.fn(()=>new Promise(resolve=>{complete=resolve}))
 render(<SundayInlineValue label="Approved time" value="19:01:16" onSave={save}/>)
 fireEvent.click(screen.getByRole('button',{name:'Approved time'}))
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'18:30:00'}})
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'})
 expect(screen.getByRole('button').textContent).toBe('19:01:16');expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button'))
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'18:30:00'}})
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'})
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'})
 expect(save).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledWith('18:30:00')
 expect(screen.getByRole('status')).not.toBeNull()
 complete(true);await screen.findByRole('button',{name:'Approved time'})
})
it('failed saves retain input; blur cancels without writing; locked values cannot edit',async()=>{
 const save=vi.fn().mockResolvedValue(false)
 const view=render(<SundayInlineValue label="Duration" value="5h01" onSave={save}/>)
 fireEvent.click(screen.getByRole('button'));fireEvent.change(screen.getByRole('textbox'),{target:{value:'bad'}})
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'})
 await waitFor(()=>expect(screen.getByRole('textbox').disabled).toBe(false))
 fireEvent.blur(screen.getByRole('textbox'));expect(screen.getByRole('button').textContent).toBe('5h01')
 expect(save).toHaveBeenCalledOnce()
 view.rerender(<SundayInlineValue label="Duration" value="5h01" disabled onSave={save}/>)
 fireEvent.click(screen.getByRole('button'));expect(screen.queryByRole('textbox')).toBeNull()
})

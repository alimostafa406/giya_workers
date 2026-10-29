// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest'
import { printTeamReport } from './teamWeeklyReport'
import { printRenderedPayrollTables } from './printRenderedPayroll'
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML=''})
const names=['JEREMIE','MBOMBA','MERVEILLE 2','RICHARD','ROBERT']
const fixture=(workers=names)=>'<section class="team-report-content team-report-team"><header><h1>Report</h1><h2>Zarour</h2></header><table><thead><tr><th>العامل</th><th>الكود</th></tr></thead><tbody>'+workers.map((name,index)=>`<tr><td>${name}</td><td>${index}</td></tr>`).join('')+'</tbody><tfoot><tr><td>إجمالي الفرقة</td><td>999</td></tr></tfoot></table></section>'

it.each(['weekly-report','payroll'])('%s popup prints an upright full-width landscape RTL table',async route=>{
 const doc=document.implementation.createHTMLDocument('Print')
 const popup={document:doc,focus:vi.fn(),print:vi.fn()}
 vi.spyOn(window,'open').mockReturnValue(popup)
 const element=document.createElement('div');element.innerHTML=fixture()
 const before=[...element.querySelectorAll('tr')].map(row=>row.textContent)
 if(route==='weekly-report')printTeamReport(element,{language:'ar',title:'Report'})
 else printRenderedPayrollTables([{name:'Zarour',element:element.querySelector('table')}],{title:'Report',language:'ar',direction:'rtl'})
 await vi.waitFor(()=>expect(popup.print).toHaveBeenCalledOnce())
 const css=doc.querySelector('style').textContent
 expect(css).toContain('@page{size:A4 landscape;margin:7mm}')
 expect(css).toContain('width:100%;max-width:none')
 expect(css).not.toMatch(/rotate\(|transform-origin|writing-mode|position:absolute|195\.5mm|height:283mm/)
 expect(doc.querySelector('[class*="rotated"]')).toBeNull()
 expect(doc.documentElement.dir).toBe('rtl')
 expect([...doc.querySelectorAll('tr')].map(row=>row.textContent)).toEqual(before)
 expect(doc.querySelector('table').style.height).toBe('')
 expect(doc.querySelector('h2').textContent).toBe('Zarour')
})

it('large teams retain all rows and use natural repeated-header pagination',async()=>{
 const doc=document.implementation.createHTMLDocument('Print')
 const popup={document:doc,focus:vi.fn(),print:vi.fn()}
 vi.spyOn(window,'open').mockReturnValue(popup)
 const element=document.createElement('div');element.innerHTML=fixture(Array.from({length:80},(_,i)=>'Worker '+i))
 printTeamReport(element,{language:'ar'})
 await vi.waitFor(()=>expect(popup.print).toHaveBeenCalledOnce())
 expect(doc.querySelectorAll('tbody tr')).toHaveLength(80)
 expect(doc.querySelectorAll('tfoot')).toHaveLength(1)
 expect(doc.querySelector('style').textContent).toContain('display:table-header-group')
 expect(doc.querySelector('style').textContent).toContain('break-before:page')
})

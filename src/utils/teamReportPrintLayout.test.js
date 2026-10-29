// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest'
import { rotateTeamPrintSheets } from './teamReportPrintLayout'
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML=''})
const names=['JEREMIE','MBOMBA','MERVEILLE 2','RICHARD','ROBERT']
const fixture=(workers=names)=>'<section class="team-report-team"><header>Zarour</header><table><thead><tr><th>العامل</th><th>الكود</th></tr></thead><tbody>'+workers.map((name,index)=>`<tr><td>${name}</td><td>${index}</td></tr>`).join('')+'</tbody><tfoot><tr><td>إجمالي الفرقة</td><td>999</td></tr></tfoot></table></section>'
function measure(){vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){
 const height=this.style.height==='100mm'?400:this.tagName==='THEAD'?52:this.tagName==='TFOOT'?44:this.tagName==='TR'?24:0
 const top=this.tagName==='TABLE'?224:100
 return {height,top,width:784,bottom:top+height,left:0,right:784,x:0,y:top,toJSON(){}}
})}
it('rotates the intact five-worker Zarour sheet, retaining RTL/order/values without row enlargement',()=>{
 document.documentElement.dir='rtl';document.body.innerHTML=fixture()
 const before=[...document.querySelectorAll('tr')].map(row=>row.textContent)
 measure();rotateTeamPrintSheets(document)
 expect(document.querySelectorAll('.payroll-rotated-sheet')).toHaveLength(1)
 expect(document.querySelectorAll('.payroll-rotated-content')).toHaveLength(1)
 expect([...document.querySelectorAll('tr')].map(row=>row.textContent)).toEqual(before)
 expect(document.querySelectorAll('tbody tr')).toHaveLength(5)
 expect([...document.querySelectorAll('tr,table')].every(node=>!node.style.height)).toBe(true)
 expect(document.documentElement.dir).toBe('rtl')
})
it('large tables continue as rotated sheets with repeated headers and totals only on the last sheet',()=>{
 const workers=Array.from({length:44},(_,i)=>'Worker '+i)
 document.body.innerHTML=fixture(workers);measure();rotateTeamPrintSheets(document)
 expect(document.querySelectorAll('.payroll-rotated-sheet')).toHaveLength(2)
 expect(document.querySelectorAll('thead')).toHaveLength(2)
 expect(document.querySelectorAll('tfoot')).toHaveLength(1)
 expect([...document.querySelectorAll('tbody tr')].map(row=>row.cells[0].textContent)).toEqual(workers)
 expect(document.querySelector('.payroll-rotated-sheet:last-child tfoot').textContent).toContain('999')
})
it('summary-only printing is wrapped and rotated too',()=>{
 document.body.innerHTML='<h1>Summary</h1><table><tbody><tr><td>10</td></tr></tbody></table>'
 rotateTeamPrintSheets(document)
 expect(document.querySelector('.payroll-rotated-content table').textContent).toBe('10')
})

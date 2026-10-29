// @vitest-environment jsdom
import { expect,it,vi } from 'vitest'
import { fullPageWorkerHeights,expandTeamPrintRows } from './teamReportPrintLayout'
it('Zarour five real rows fill the remaining landscape sheet without blank rows',()=>{
 const heights=fullPageWorkerHeights({headingMm:31,headMm:13,footMm:11,rowHeightsMm:[6,6,6,6,6]})
 expect(heights).toHaveLength(5)
 expect(heights.every(height=>height>20&&height<32)).toBe(true)
 expect(31+13+11+heights.reduce((sum,height)=>sum+height,0)).toBeCloseTo(195)
})
it('large teams stay compact and paginate rather than being shrunk',()=>{
 expect(fullPageWorkerHeights({headingMm:31,headMm:13,footMm:11,rowHeightsMm:Array(44).fill(6)})).toBeNull()
})
it('wrapping names keep their natural heights and smaller teams receive more space',()=>{
 const base={headingMm:31,headMm:13,footMm:11}
 const two=fullPageWorkerHeights({...base,rowHeightsMm:[6,10]})
 const five=fullPageWorkerHeights({...base,rowHeightsMm:Array(5).fill(6)})
 expect(two[1]).toBeGreaterThan(two[0])
 expect(two[0]).toBeGreaterThan(five[0])
 expect(two.every(height=>height>=6&&height<=160)).toBe(true)
 expect(fullPageWorkerHeights({...base,rowHeightsMm:[]})).toBeNull()
})
it('applies measured full-page heights to the five existing rows, not the summary or extra blank rows',()=>{
 document.body.innerHTML='<section class="team-report-team"><header>Zarour</header><table><thead><tr><th>Worker</th></tr></thead><tbody>'+['JEREMIE','MBOMBA','MERVEILLE 2','RICHARD','ROBERT'].map(name=>`<tr><td>${name}</td></tr>`).join('')+'</tbody><tfoot><tr><td>Total</td></tr></tfoot></table></section><section class="team-report-summary"><table><tbody><tr><td>Summary</td></tr></tbody></table></section>'
 const spy=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){
   const height=this.style.height==='100mm'?400:this.tagName==='THEAD'?52:this.tagName==='TFOOT'?44:this.tagName==='TR'?24:0
   const top=this.tagName==='TABLE'?224:100
   return {height,top,width:1132,bottom:top+height,left:0,right:1132,x:0,y:top,toJSON(){}}
 })
 try {
   expandTeamPrintRows(document)
   const table=document.querySelector('.team-report-team table')
   expect(table.dataset.fullPagePayroll).toBe('true')
   expect(table.tBodies[0].rows).toHaveLength(5)
   expect([...table.tBodies[0].rows].every(row=>row.style.height==='28mm')).toBe(true)
   expect(parseFloat(table.style.height)+31).toBe(195)
   expect(document.querySelector('.team-report-summary table').style.height).toBe('')
 } finally {spy.mockRestore();document.body.innerHTML=''}
})

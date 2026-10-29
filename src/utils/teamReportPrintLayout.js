// A4 landscape is 210mm high; two 7mm margins leave 196mm.
export function fullPageWorkerHeights({ headingMm, headMm, footMm, rowHeightsMm, pageMm = 196 }) {
  if (!rowHeightsMm.length) return null
  const available = pageMm - 1 - headingMm - headMm - footMm // rounding/border safety
  const minimums = rowHeightsMm.map(height => Math.max(6, height))
  const used = minimums.reduce((sum,height)=>sum+height,0)
  if (used > available) return null // large teams paginate naturally, never shrink
  const extra = (available-used)/minimums.length
  return minimums.map(height=>Math.min(160,height+extra))
}

export function expandTeamPrintRows(doc) {
  if (!doc?.querySelectorAll || !doc.createElement) return
  const ruler=doc.createElement('div')
  ruler.style.cssText='position:absolute;visibility:hidden;height:100mm;width:1mm'
  doc.body.appendChild(ruler)
  const pxPerMm=ruler.getBoundingClientRect().height/100
  ruler.remove()
  if (!pxPerMm) return
  for (const section of doc.querySelectorAll('.team-report-team')) {
    const table=section.querySelector('table'),rows=[...(table?.tBodies[0]?.rows || [])]
    if (!table || !rows.length) continue
    const headingMm=(table.getBoundingClientRect().top-section.getBoundingClientRect().top)/pxPerMm
    const headMm=(table.tHead?.getBoundingClientRect().height || 0)/pxPerMm
    const footMm=(table.tFoot?.getBoundingClientRect().height || 0)/pxPerMm
    const heights=fullPageWorkerHeights({headingMm,headMm,footMm,rowHeightsMm:rows.map(row=>row.getBoundingClientRect().height/pxPerMm)})
    if (!heights) continue
    rows.forEach((row,index)=>{row.style.height=`${heights[index]}mm`})
    if (table.tHead) table.tHead.style.height=`${headMm}mm`
    if (table.tFoot) table.tFoot.style.height=`${footMm}mm`
    table.style.height=`${headMm+footMm+heights.reduce((sum,height)=>sum+height,0)}mm`
    table.dataset.fullPagePayroll='true'
  }
}

// Rotate the complete rendered sheet clockwise: its original RTL start at the
// right edge becomes the bottom edge of the paper. Never transpose cells.
export function rotateTeamPrintSheets(doc) {
  if (!doc?.querySelectorAll || !doc.createElement) return
  if (doc.querySelector('.payroll-rotated-sheet')) return
  let sections=[...doc.querySelectorAll('.team-report-team,.team-report-summary,.team')]
  if (!sections.length) {
    const section=doc.createElement('section')
    section.className='team-report-content team-report-summary'
    section.innerHTML=doc.body.innerHTML
    doc.body.replaceChildren(section)
    sections=[section]
  }
  const ruler=doc.createElement('div')
  ruler.style.cssText='position:absolute;visibility:hidden;height:100mm;width:1mm'
  doc.body.appendChild(ruler)
  const pxPerMm=ruler.getBoundingClientRect().height/100
  ruler.remove()
  const pages=[]
  for (const source of sections) {
    const table=source.querySelector('table'), rows=[...(table?.tBodies[0]?.rows || [])]
    let groups=[rows]
    if (pxPerMm && table && rows.length) {
      const heading=(table.getBoundingClientRect().top-source.getBoundingClientRect().top)/pxPerMm
      const head=(table.tHead?.getBoundingClientRect().height || 0)/pxPerMm
      const foot=(table.tFoot?.getBoundingClientRect().height || 0)/pxPerMm
      const budget=Math.max(20,283-2-heading-head-foot)
      groups=[];let chunk=[],used=0
      for (const row of rows) {
        const height=row.getBoundingClientRect().height/pxPerMm
        if (chunk.length && used+height>budget) {groups.push(chunk);chunk=[];used=0}
        chunk.push(row);used+=height
      }
      if (chunk.length) groups.push(chunk)
    }
    groups.forEach((group,index)=>{
      const content=source.cloneNode(true)
      const copy=content.querySelector('table')
      if (copy?.tBodies[0]) {
        copy.tBodies[0].replaceChildren(...group.map(row=>row.cloneNode(true)))
        if (index<groups.length-1) copy.tFoot?.remove()
      }
      const page=doc.createElement('div'),rotated=doc.createElement('div')
      page.className='payroll-rotated-sheet'
      rotated.className='payroll-rotated-content'
      rotated.appendChild(content);page.appendChild(rotated);pages.push(page)
    })
  }
  doc.body.replaceChildren(...pages)
}

// Landscape changes the paper dimensions, not the printed table's direction.
// Use the same physical rotation for both payroll print entry points.
export const rotatedPayrollPrintCss = `
@page{size:A4 landscape;margin:7mm}
@media screen{body{width:283mm}}
.team-report-team,.team-report-summary,.team{width:195.5mm}
.payroll-rotated-sheet{position:relative;width:283mm;height:195.5mm;break-after:page;page-break-after:always;overflow:hidden}
.payroll-rotated-sheet:last-child{break-after:auto;page-break-after:auto}
.payroll-rotated-content{position:absolute;left:283mm;top:0;width:195.5mm;height:283mm;transform:rotate(90deg);transform-origin:top left}
.payroll-rotated-content .team-report-content,.payroll-rotated-content .team{width:100%;height:auto;min-height:0;break-before:auto;page-break-before:auto}
`

export function finishRotatedPayrollPrint(popup) {
  const prepare = () => rotateTeamPrintSheets(popup.document)
  popup.addEventListener?.('beforeprint', prepare)
  return Promise.resolve(popup.document.fonts?.ready).then(() => {
    prepare()
    popup.focus()
    popup.print()
  })
}

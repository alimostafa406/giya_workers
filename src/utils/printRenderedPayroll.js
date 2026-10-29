const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

import { finishPayrollPrint, payrollLandscapePrintCss } from './teamReportPrintLayout.js'

// Clone the live React table, including its actual order, cells and tfoot.
// No attendance, overtime, monetary or total calculation belongs here.
export function renderedPayrollTableHtml(element) {
  const source = element?.matches?.('table') ? element : element?.querySelector('[data-weekly-payroll-sheet] table')
  if (!source) throw new Error('Payroll table is not ready to print')
  const table = source.cloneNode(true)
  table.querySelectorAll('[data-payroll-edit-controls],input,select,textarea,[role="alert"]').forEach(node=>node.remove())
  table.querySelectorAll('button,a').forEach(node=>node.replaceWith(...node.childNodes))
  // Standalone print styles replace screen sizing/overflow/visibility utilities.
  table.querySelectorAll('[class]').forEach(node=>node.removeAttribute('class'))
  table.removeAttribute('class')
  // Column sizing is presentation only; preserve every original cell/value.
  // Worker + weekdays + wages/OT hours/OT amount/transport/final payable.
  const dayCount = table.tHead?.rows[0]?.cells.length - 6
  if (dayCount > 0) {
    table.querySelectorAll('colgroup').forEach(node=>node.remove())
    const columns = table.ownerDocument.createElement('colgroup')
    for (const width of [18,...Array(dayCount).fill(30/dayCount),11,7,11,10,13]) {
      const col = table.ownerDocument.createElement('col')
      col.style.width = `${width}%`
      columns.appendChild(col)
    }
    table.insertBefore(columns,table.tHead)
  }
  return table.outerHTML
}

export function printRenderedPayrollTables(sections, { title, metadata = [], language = 'ar', direction = 'rtl' }) {
  if (!sections.length) return false
  const content = sections.map(({ name, element })=>`<section class="team"><header><h1>${escape(title)}</h1><div class="meta">${metadata.map(text=>`<p>${escape(text)}</p>`).join('')}</div><h2>${escape(name)}</h2></header>${renderedPayrollTableHtml(element)}</section>`).join('')
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.open?.()
  popup.document.write(`<!doctype html><html lang="${escape(language)}" dir="${direction === 'rtl' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}
    html,body{width:100%;max-width:none;min-width:0;height:auto;min-height:0;margin:0;padding:0}
    body{color:#172033;font-family:Arial,Tahoma,sans-serif;font-size:9.5pt;line-height:1.25}
    h1{font-size:14pt;margin:0 0 2mm}h2{font-size:12pt;margin:2mm 0;break-after:avoid;page-break-after:avoid}
    .meta{display:flex;flex-wrap:wrap;gap:1mm 5mm;margin:0 0 2mm;font-size:9pt}.meta p{margin:0}
    .team{width:100%;max-width:none;min-width:0;height:auto;min-height:0;margin:0;padding:0}
    table{width:100%;max-width:none;min-width:0;table-layout:fixed;border-collapse:collapse;margin:0}
    th,td{border:1px solid #64748b;padding:1.4mm 1mm;font-size:9.5pt;text-align:center;vertical-align:middle;white-space:normal;overflow-wrap:anywhere;overflow:visible}
    thead th{font-size:9pt;line-height:1.2}th:first-child,td:first-child{text-align:start}
    thead{display:table-header-group;background:#f1f5f9}tfoot{display:table-row-group;font-weight:800;background:#e2e8f0}
    tfoot tr,tr{break-inside:avoid;page-break-inside:avoid}td span,td small,th span{display:block}
    bdi,[dir="ltr"]{unicode-bidi:isolate}small{font-size:9pt}.team+.team{break-before:page;page-break-before:always}
    @media print{html,body,.team,table{width:100%;max-width:none;min-width:0;height:auto;min-height:0;margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}button,input,select,textarea,nav,[hidden]{display:none!important}}
    ${payrollLandscapePrintCss}
  </style></head><body>${content}</body></html>`)
  popup.document.close()
  finishPayrollPrint(popup)
  return true
}

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

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
  return table.outerHTML
}

export function printRenderedPayrollTables(sections, { title, metadata = [], language = 'ar', direction = 'rtl' }) {
  if (!sections.length) return false
  const content = sections.map(({ name, element })=>`<section class="team"><h2>${escape(name)}</h2>${renderedPayrollTableHtml(element)}</section>`).join('')
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="${escape(language)}" dir="${direction === 'rtl' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:Arial,Tahoma,sans-serif;font-size:10px}
    h1{font-size:18px;margin:0 0 8px}h2{font-size:14px;margin:12px 0 6px;break-after:avoid}.meta{margin-bottom:10px}.meta p{margin:3px 0}
    table{width:100%;table-layout:auto;border-collapse:collapse}th,td{border:1px solid #94a3b8;padding:5px 3px;font-size:9px;text-align:center;vertical-align:middle;overflow:visible}th:first-child,td:first-child{text-align:start}thead{display:table-header-group;background:#f1f5f9}tfoot{display:table-row-group;font-weight:800;background:#e2e8f0}tfoot tr{break-inside:avoid;page-break-inside:avoid}tr{break-inside:avoid;page-break-inside:avoid}td span,td small,th span{display:block}bdi,[dir="ltr"]{unicode-bidi:isolate}small{font-size:8px}.team+.team{break-before:page;page-break-before:always}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}button,input,select,textarea,nav{display:none!important}}
  </style></head><body><h1>${escape(title)}</h1><div class="meta">${metadata.map(text=>`<p>${escape(text)}</p>`).join('')}</div>${content}</body></html>`)
  popup.document.close()
  Promise.resolve(popup.document.fonts?.ready).then(()=>{popup.focus();popup.print()})
  return true
}

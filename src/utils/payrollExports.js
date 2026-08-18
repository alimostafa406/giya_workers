import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

const escapeHtml = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

export const printPayrollReport = ({ title, metadata, headers, rows, totals, direction = 'rtl' }) => {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const rowHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
  const totalHtml = totals.map((row) => `<tr class="total">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
  printWindow.document.write(`<html dir="${direction}"><head><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#172033}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:${direction === 'rtl' ? 'right' : 'left'};font-size:11px}th{background:#f1f5f9}.meta{display:grid;gap:4px}.total{font-weight:700;background:#f8fafc}@media print{body{padding:0}}</style></head><body><h2>${escapeHtml(title)}</h2><div class="meta">${metadata.map((item) => `<div>${escapeHtml(item)}</div>`).join('')}</div><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}${totalHtml}</tbody></table></body></html>`)
  printWindow.document.close(); printWindow.focus(); printWindow.print()
  return true
}

export const exportPayrollExcel = ({ title, metadata, headers, rows, totals, sheetName, filename }) => {
  const sheet = XLSX.utils.aoa_to_sheet([[title], ...metadata.map((item) => [item]), [], headers, ...rows, ...totals])
  sheet['!cols'] = headers.map(() => ({ wch: 18 }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, filename)
}

export const exportPayrollPdf = ({ language, title, metadata, headers, rows, totals, filename }) => {
  if (language === 'ar') return { supported: false }
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14); doc.text(title, 14, 14); doc.setFontSize(9)
  metadata.forEach((item, index) => doc.text(String(item), 14, 20 + index * 5))
  autoTable(doc, { head: [headers], body: [...rows, ...totals], startY: 20 + metadata.length * 5 + 4, styles: { fontSize: 7 }, headStyles: { fillColor: [39, 39, 42] } })
  doc.save(filename)
  return { supported: true }
}

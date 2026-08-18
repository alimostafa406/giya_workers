import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/LanguageContext'

function Table({ columns, data, loading, emptyMessage, payrollSheet = false }) {
  const { t } = useTranslation()
  const scrollRef = useRef(null)
  const topScrollRef = useRef(null)
  const tableRef = useRef(null)
  const [scrollWidth, setScrollWidth] = useState(0)

  useEffect(() => {
    if (!payrollSheet) return undefined
    const updateWidth = () => setScrollWidth(tableRef.current?.scrollWidth || 0)
    updateWidth()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    if (tableRef.current && observer) observer.observe(tableRef.current)
    window.addEventListener('resize', updateWidth)
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateWidth) }
  }, [columns.length, data.length, payrollSheet])

  const syncFromTop = (event) => { if (scrollRef.current) scrollRef.current.scrollLeft = event.currentTarget.scrollLeft }
  const syncFromTable = (event) => { if (topScrollRef.current) topScrollRef.current.scrollLeft = event.currentTarget.scrollLeft }

  return (
    <div className={`surface-card bg-white ${payrollSheet ? 'overflow-visible' : 'overflow-hidden'}`}>
      {payrollSheet ? <div ref={topScrollRef} className="sticky top-0 z-40 overflow-x-auto border-b border-(--border) bg-white/95 pb-1 backdrop-blur" onScroll={syncFromTop}><div style={{ width: scrollWidth, height: 1 }} /></div> : null}
      <div ref={scrollRef} className="overflow-x-auto" onScroll={payrollSheet ? syncFromTable : undefined}>
        <table ref={tableRef} className="w-full min-w-160 text-right">
          <thead className="bg-slate-50/80">
            <tr>
              {columns.map((column, columnIndex) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-5 py-3.5 text-xs font-extrabold tracking-wide text-(--muted) ${payrollSheet ? 'sticky top-1 z-30 bg-slate-50/95' : ''} ${payrollSheet && columnIndex === 0 ? 'sticky end-0 z-40 shadow-[-4px_0_8px_rgba(15,23,42,0.08)]' : ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-14 text-center text-sm font-medium text-(--muted)"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-(--primary)" />
                    {t('app.loading')}
                  </span>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-14 text-center text-sm font-medium text-(--muted)"
                >
                  {emptyMessage || t('common.noRecords')}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr key={row.id || idx} className="group border-t border-(--border) transition-colors hover:bg-slate-50/70">
                  {columns.map((column, columnIndex) => (
                    <td key={column.key} className={`whitespace-nowrap px-5 py-4 text-sm font-medium text-(--text) ${payrollSheet && columnIndex === 0 ? 'sticky end-0 z-20 bg-white shadow-[-4px_0_8px_rgba(15,23,42,0.08)] group-hover:bg-slate-50/70' : ''}`}>
                      {column.render ? column.render(row) : row[column.key] || '-'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Table

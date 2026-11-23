import './WeeklyPayrollSheet.css'

// Shared by the main weekly payroll and Sunday payroll. Only the column schema
// differs; the table surface, typography, rows, worker identity and totals agree.
export const payrollSheetClasses={
 header:'px-2 py-2.5 text-center text-xs font-extrabold text-(--muted)',
 row:'border-t border-(--border) hover:bg-slate-50/70',
 cell:'px-2 py-2.5 text-center',
 total:'bg-slate-100 font-extrabold print:table-row-group',
 totalRow:'border-t-2 border-slate-400 break-inside-avoid',
}
export function PayrollWorkerIdentity({worker,secondary,children}){
 return <><span className="text-start font-extrabold text-(--primary)">{worker.full_name}</span>{secondary&&<small className="block text-xs font-normal text-(--muted)">{secondary}</small>}<span className="mt-0.5 block text-xs font-medium text-(--muted)">{worker.employee_code||'—'}</span>{children}</>
}
export default function PayrollSheetFrame({children,variant='weekly'}){
 return <div className="surface-card overflow-x-auto bg-white" data-payroll-sheet={variant} data-weekly-payroll-sheet={variant==='weekly'?true:undefined}><table className="w-full table-fixed border-collapse text-sm">{children}</table></div>
}

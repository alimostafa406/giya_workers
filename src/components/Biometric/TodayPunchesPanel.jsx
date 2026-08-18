function TodayPunchesPanel({ counters, warning, success, onToggleUnconfirmed }) {
  return <div className="mb-5 surface-card p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{counters.map(([label, count]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-sm text-(--muted)">{label}</p><p className="mt-1 text-2xl font-extrabold text-(--primary)">{count}</p></div>)}</div>{warning ? <button type="button" className="alert alert--error mt-4 w-full text-right" onClick={onToggleUnconfirmed}>{warning}</button> : <p className="alert alert--success mt-4">{success}</p>}</div>
}

export default TodayPunchesPanel

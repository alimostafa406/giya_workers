const timeLabel = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TodayPunchesPanel({ t, activity, loading, error, onRefresh }) {
  const identities = activity?.identities || []
  return <section className="surface-card mb-4 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--border) p-4"><div><h3 className="font-extrabold">{t('biometric.punchedToday')} {activity ? `(${identities.length})` : ''}</h3><p className="mt-1 text-sm text-(--muted)">{t('biometric.eventCount')}: {activity?.events ?? '—'}</p></div><button type="button" className="btn-secondary" disabled={loading} onClick={onRefresh}>{t('common.refresh')}</button></div>{loading ? <p className="p-4 text-sm text-(--muted)">{t('common.loading')}</p> : null}{!loading && error ? <p className="alert alert--error m-4">{t('biometric.activityUnavailable')}</p> : null}{!loading && !error && activity ? <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-sm"><thead className="bg-slate-50 text-start text-(--muted)"><tr><th className="p-3 text-start">{t('common.worker')}</th><th className="p-3 text-start">{t('teams.deviceNumber')}</th><th className="p-3 text-start">{t('biometric.firstPunch')}</th><th className="p-3 text-start">{t('biometric.lastPunch')}</th><th className="p-3 text-start">{t('biometric.eventCount')}</th><th className="p-3 text-start">{t('biometric.devices')}</th></tr></thead><tbody>{identities.map((identity) => <tr key={identity.employeeNo} className="border-t border-(--border)"><td className="p-3 font-semibold">{identity.name || '—'}</td><td className="p-3" dir="ltr">{identity.employeeNo}</td><td className="p-3" dir="ltr">{timeLabel(identity.first_punch_today)}</td><td className="p-3" dir="ltr">{timeLabel(identity.last_punch_today)}</td><td className="p-3">{identity.today_event_count}</td><td className="p-3">{(identity.devices_seen_today || []).join(' / ') || '—'}</td></tr>)}{!identities.length ? <tr><td className="p-4 text-(--muted)" colSpan="6">{t('biometric.empty')}</td></tr> : null}</tbody></table></div> : null}</section>
}

export default TodayPunchesPanel

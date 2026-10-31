import { outsideWorkMarkerLabels } from '../../utils/outsideWorkTeamMarkers'

export default function OutsideWorkTeamMarkers({ markers = [], dates, language = 'ar', presenceLabel = 'O' }) {
  if (!markers.length) return null
  const labels = outsideWorkMarkerLabels[language] || outsideWorkMarkerLabels.en
  return <section className="outside-work-team-markers overflow-x-auto" aria-label={labels.title}>
    <h3 className="mt-3 mb-2 text-sm font-semibold">{labels.title}</h3>
    <table className="w-full border-collapse text-sm"><thead><tr>
      <th>{labels.worker}</th><th>{labels.code}</th><th>{labels.team}</th>
      {dates.map((date) => <th key={date}><bdi dir="ltr">{date}</bdi></th>)}
    </tr></thead><tbody>{markers.map(({ worker, dates: outsideDates }) => <tr key={worker.id}>
      <td>{worker.full_name}</td><td>{worker.employee_code || '—'}</td><td>{worker.team_name || worker.team?.name || '—'}</td>
      {dates.map((date) => <td key={date}>{outsideDates.includes(date) ? presenceLabel : '—'}</td>)}
    </tr>)}</tbody></table>
  </section>
}

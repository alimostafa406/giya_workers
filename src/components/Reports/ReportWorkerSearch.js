import React from 'react'

export default function ReportWorkerSearch({ value, onChange, label, placeholder }) {
  return React.createElement(
    'label',
    { className: 'min-w-60 text-sm font-bold', 'data-testid': 'report-worker-search' },
    React.createElement('span', { className: 'mb-1 block' }, label),
    React.createElement('input', {
      'aria-label': label,
      className: 'input-base w-full',
      type: 'search',
      value,
      onChange: (event) => onChange(event.target.value),
      placeholder,
    }),
  )
}

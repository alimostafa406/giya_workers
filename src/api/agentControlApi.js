const request = async (path, options = {}) => {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json', 'X-Agent-Control': 'local-dashboard' } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Local agent control is unavailable.')
  return data
}

export const getAgentControlStatus = () => request('/api/agent-control/status')

export const runAgentControlAction = (action) => request('/api/agent-control/action', {
  method: 'POST', body: JSON.stringify({ action }),
})

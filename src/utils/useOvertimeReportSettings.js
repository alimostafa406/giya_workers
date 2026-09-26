import { useCallback, useEffect, useRef, useState } from 'react'
import { getOvertimeReportSettings } from '../api/overtimeReportSettingsApi.js'
import { getErrorMessage } from '../api/axios.js'
export const EMPTY_OVERTIME_TEAMS = []
export function useOvertimeReportSettings(scopeKey = '') {
  const [settings, setSettings] = useState({ team_ids: [], teams: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await getOvertimeReportSettings()
      if (request === generation.current) { setSettings(result); setError('') }
    } catch (cause) {
      if (request === generation.current) { setSettings({ team_ids: [], teams: [] }); setError(getErrorMessage(cause)) }
    } finally { if (request === generation.current) setLoading(false) }
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    window.addEventListener('overtime-report-settings-changed', load)
    return () => {
      invalidate()
      window.removeEventListener('focus', load)
      window.removeEventListener('overtime-report-settings-changed', load)
    }
  }, [load, scopeKey, invalidate])
  return { settings, error, loading, load }
}

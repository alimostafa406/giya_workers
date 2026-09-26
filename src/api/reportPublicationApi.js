import { getSupabaseClient } from '../lib/supabase'
import { buildReportPublicationDays } from '../utils/reportPublication.js'

const rpc = async (name, args) => {
  const { data, error } = await getSupabaseClient().rpc(name, args)
  if (error) throw error
  return data
}
export const getReportPublication = () => rpc('get_current_report_publication_admin')
export const stopReportPublication = () => rpc('stop_current_report_publication_admin')
export const publishReportPublication = async () => {
  const source = await rpc('get_current_report_publication_source_admin')
  return rpc('publish_current_report_publication_admin', {
    p_source_revision: source.source_revision, p_days: buildReportPublicationDays(source),
  })
}

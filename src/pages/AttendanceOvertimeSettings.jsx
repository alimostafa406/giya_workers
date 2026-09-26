import React from 'react'
import OvertimeReportSettings from '../components/Reports/OvertimeReportSettings.jsx'
import { useOvertimeReportSettings } from '../utils/useOvertimeReportSettings.js'
import { useTranslation } from '../i18n/LanguageContext.jsx'
import { useAuthStore } from '../store/authStore.js'

export default function AttendanceOvertimeSettings() {
  const { t, language } = useTranslation()
  const admin = useAuthStore(state => state.admin)
  const model = useOvertimeReportSettings('site-settings')
  if (!admin?.is_active) return null
  return <section dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <p className="mb-2 text-sm text-(--muted)">{t('navigation.settings')}</p>
    <h1 className="mb-5 text-2xl font-extrabold">{t('navigation.attendanceOvertimeSettings')}</h1>
    <OvertimeReportSettings model={model} />
  </section>
}

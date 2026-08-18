import { Link } from 'react-router-dom'
import AttendanceAgentStatus from '../components/Attendance/AttendanceAgentStatus'
import BiometricAttendanceSyncPanel from '../components/Attendance/BiometricAttendanceSyncPanel'
import { useTranslation } from '../i18n/LanguageContext'

export default function AdvancedSettings() {
  const { t } = useTranslation()
  return <section>
    <h2 className="text-xl font-extrabold">{t('navigation.advanced')}</h2>
    <p className="mt-2 text-sm text-(--muted)">{t('advanced.description')}</p>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="surface-card p-5"><h3 className="font-extrabold">{t('navigation.biometricMapping')}</h3><p className="mt-2 text-sm text-(--muted)">{t('advanced.mappingDescription')}</p><Link className="btn-secondary mt-4" to="/biometric-mapping">{t('common.details')}</Link></div>
      <div className="surface-card p-5"><h3 className="font-extrabold">{t('navigation.missingAttendance')}</h3><p className="mt-2 text-sm text-(--muted)">{t('advanced.missingDescription')}</p><Link className="btn-secondary mt-4" to="/missing-attendance">{t('common.details')}</Link></div>
    </div>
    <div className="mt-5"><AttendanceAgentStatus /></div>
    <div className="mt-5"><BiometricAttendanceSyncPanel /></div>
  </section>
}

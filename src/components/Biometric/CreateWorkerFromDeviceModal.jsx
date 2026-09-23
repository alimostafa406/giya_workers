import { useEffect, useRef, useState } from 'react'
import Modal from '../Modal/Modal'
import { useTranslation } from '../../i18n/LanguageContext'
import { workerRequiresOperationalTeam } from '../../utils/workerTeamEligibility'

export default function CreateWorkerFromDeviceModal({ deviceUser, teams, initialEmployeeCode = '', isOpen, isSaving, onClose, onSubmit }) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [teamId, setTeamId] = useState('')
  const [staffClassification, setStaffClassification] = useState('normal')
  const [paymentType, setPaymentType] = useState('weekly')
  const initializedForCurrentOpening = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      initializedForCurrentOpening.current = false
      return
    }
    if (initializedForCurrentOpening.current) return
    initializedForCurrentOpening.current = true
    setFullName(deviceUser?.name || '')
    setEmployeeCode(initialEmployeeCode)
    setTeamId('')
    setStaffClassification('normal')
    setPaymentType('weekly')
  }, [deviceUser, initialEmployeeCode, isOpen])

  const save = (event) => {
    event.preventDefault()
    onSubmit({ fullName, employeeCode, teamId: teamId || null, staffClassification, paymentType })
  }

  const teamRequired = workerRequiresOperationalTeam({ staff_classification: staffClassification, payment_type: paymentType })

  return <Modal isOpen={isOpen} title={t('biometric.addNewWorker')} onClose={onClose}>
    <form className="space-y-4" onSubmit={save}>
      <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">{t('biometric.newWorkerFromDevice', { name: deviceUser?.name || '—', employeeNo: deviceUser?.employeeNo || '—' })}</p>
      <label className="block text-sm font-bold"><span>{t('workers.name')}</span><input className="input-base mt-1" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
      <label className="block text-sm font-bold"><span>{t('workers.employeeCode')}</span><input className="input-base mt-1" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} required /></label>
      <label className="block text-sm font-bold"><span>{t('biometricMapping.operationalClass')}</span><select className="input-base mt-1" value={staffClassification} onChange={(event) => setStaffClassification(event.target.value)}><option value="normal">{t('biometricMapping.normalWorker')}</option><option value="special_staff">{t('biometricMapping.specialWorker')}</option></select></label>
      <label className="block text-sm font-bold"><span>{t('payroll.paymentType')}</span><select className="input-base mt-1" value={paymentType} onChange={(event) => setPaymentType(event.target.value)}><option value="weekly">{t('payroll.weekly')}</option><option value="monthly">{t('payroll.monthly')}</option></select></label>
      <label className="block text-sm font-bold"><span>{t('common.team')}</span><select className="input-base mt-1" value={teamId} onChange={(event) => setTeamId(event.target.value)} required={teamRequired}><option value="">{teamRequired ? t('common.chooseTeam') : t('workers.noTeam')}</option>{(teams || []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{!teamRequired ? <span className="mt-1 block text-xs font-normal text-(--muted)">{t('workers.noTeamAllowed')}</span> : null}</label>
      <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary" disabled={isSaving}>{isSaving ? t('common.saving') : t('common.save')}</button><button type="button" className="btn-secondary" disabled={isSaving} onClick={onClose}>{t('common.cancel')}</button></div>
    </form>
  </Modal>
}

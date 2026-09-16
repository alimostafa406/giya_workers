import { isActiveWorker } from './activeWorkers.js'

const normalized = (value) => String(value || '').trim().toLocaleLowerCase()

const biometricNumbers = (worker = {}) => [
  worker.employeeNoString,
  worker.employee_no_string,
  worker.biometric_employee_no,
  worker.device_employee_no,
  ...(worker.biometric_mappings || []).flatMap((mapping) => [mapping?.device_employee_no, mapping?.employeeNoString]),
]

export const payrollWorkerMatchesSearch = (worker, search) => {
  const query = normalized(search)
  if (!query) return true
  return [worker?.full_name, worker?.employee_code, ...biometricNumbers(worker)]
    .some((value) => normalized(value).includes(query))
}

export const payrollWorkerSearchResults = (lines = [], search = '', paymentType) => {
  const query = normalized(search)
  if (!query) return []
  return (Array.isArray(lines) ? lines : []).filter((line) => {
    const worker = line?.worker
    return isActiveWorker(worker)
      && worker?.payment_type === paymentType
      && (worker?.staff_classification || 'normal') === 'normal'
      && payrollWorkerMatchesSearch(worker, query)
  })
}

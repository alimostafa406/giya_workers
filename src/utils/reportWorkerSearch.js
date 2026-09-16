const normalized = (value) => String(value || '').trim().toLocaleLowerCase()

export const reportWorkerMatchesSearch = (worker = {}, search = '') => {
  const query = normalized(search)
  if (!query) return true
  return [
    worker.full_name,
    worker.workerName,
    worker.name,
    worker.employee_code,
    worker.employeeCode,
    worker.employeeNoString,
    worker.biometric_employee_no,
    worker.biometricEmployeeNo,
  ].some((value) => normalized(value).includes(query))
}

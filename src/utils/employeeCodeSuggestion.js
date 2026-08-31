const numericEmployeeCodePattern = /^\d+$/

export const getNumericEmployeeCodeSequence = (workers) => {
  let highest = null

  for (const worker of Array.isArray(workers) ? workers : []) {
    const code = String(worker?.employee_code ?? '').trim()
    if (!numericEmployeeCodePattern.test(code)) continue

    const numericCode = BigInt(code)
    if (highest === null || numericCode > highest) highest = numericCode
  }

  return {
    highest: highest?.toString() ?? null,
    next: ((highest ?? 0n) + 1n).toString(),
  }
}

export const getNextNumericEmployeeCode = (workers) => getNumericEmployeeCodeSequence(workers).next

export const isDuplicateEmployeeCodeError = (error) => (
  String(error?.code || '') === '23505'
  && /employee[_ -]?code/i.test(`${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`)
)

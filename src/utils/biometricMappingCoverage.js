const normalized = (value) => String(value || '').trim()

const activeMappings = (mappings = []) => mappings.filter((mapping) => (
  mapping?.is_active !== false
  && normalized(mapping?.worker_id)
  && normalized(mapping?.device_employee_no)
))

const identityKey = (mapping) => `${normalized(mapping.device_id) || 'legacy'}::${normalized(mapping.device_employee_no)}`

export const buildBiometricCoverageByWorker = (mappings = []) => {
  const active = activeMappings(mappings)
  const ownersByIdentity = new Map()
  const mappingsByWorker = new Map()

  active.forEach((mapping) => {
    const workerId = normalized(mapping.worker_id)
    const key = identityKey(mapping)
    ownersByIdentity.set(key, new Set([...(ownersByIdentity.get(key) || []), workerId]))
    mappingsByWorker.set(workerId, [...(mappingsByWorker.get(workerId) || []), mapping])
  })

  return new Map([...mappingsByWorker.entries()].map(([workerId, workerMappings]) => {
    const hasConflict = workerMappings.some((mapping) => (ownersByIdentity.get(identityKey(mapping))?.size || 0) > 1)
    const hasNeedsReview = workerMappings.some((mapping) => mapping.mapping_review_state !== 'confirmed')
    const confirmedCount = workerMappings.filter((mapping) => mapping.mapping_review_state === 'confirmed').length
    const status = hasConflict
      ? 'conflict'
      : hasNeedsReview
        ? 'needs_review'
        : confirmedCount > 1
          ? 'multiple_identities'
          : confirmedCount === 1
            ? 'mapped'
            : 'unmapped'
    return [workerId, { status, mappings: workerMappings }]
  }))
}

export const biometricCoverageForWorker = (coverageByWorker, workerId) => (
  coverageByWorker.get(normalized(workerId)) || { status: 'unmapped', mappings: [] }
)

const labels = {
  ar: {
    mapped: 'مرتبط',
    multiple_identities: 'هويات متعددة',
    needs_review: 'بحاجة للمراجعة',
    conflict: 'تعارض',
    unmapped: 'غير مرتبط / تغطية البصمة مفقودة',
  },
  en: {
    mapped: 'Mapped',
    multiple_identities: 'Multiple identities',
    needs_review: 'Needs review',
    conflict: 'Conflict',
    unmapped: 'Unmapped / biometric coverage missing',
  },
  fr: {
    mapped: 'Lié',
    multiple_identities: 'Identités multiples',
    needs_review: 'À vérifier',
    conflict: 'Conflit',
    unmapped: 'Non lié / couverture biométrique absente',
  },
}

export const biometricCoverageLabel = (status, language = 'en') => (
  (labels[language] || labels.en)[status] || status
)

export const biometricCoverageBadgeClass = (status) => {
  if (status === 'mapped' || status === 'multiple_identities') return 'status-badge--success'
  if (status === 'needs_review') return 'status-badge--warning'
  if (status === 'conflict') return 'status-badge--danger'
  return 'status-badge--neutral'
}

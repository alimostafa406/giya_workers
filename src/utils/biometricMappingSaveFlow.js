export const completeCriticalBiometricMappingSave = async ({
  saveMapping,
  onMapped,
  runPostSave,
  onPostSaveError,
}) => {
  const result = await saveMapping()
  onMapped(result)

  // Device reconciliation and workspace refresh are deliberately detached
  // from the critical save. Their failure cannot turn a committed mapping
  // into a false save failure in the UI.
  void Promise.resolve()
    .then(runPostSave)
    .catch((error) => onPostSaveError?.(error))

  return result
}

export const completeCriticalBiometricWorkerCreation = ({
  createWorker,
  onCreated,
  runPostSave,
  onPostSaveError,
}) => completeCriticalBiometricMappingSave({
  saveMapping: createWorker,
  onMapped: onCreated,
  runPostSave,
  onPostSaveError,
})

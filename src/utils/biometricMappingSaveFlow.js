export const completeCriticalBiometricWorkerCreation = async ({
  createWorker,
  onCreated,
  runPostSave,
  onPostSaveError,
}) => {
  const result = await createWorker()
  onCreated(result)

  // Device reconciliation and workspace refresh are deliberately detached
  // from the critical save. Their failure cannot turn a committed worker and
  // mapping into a false creation failure in the UI.
  void Promise.resolve()
    .then(runPostSave)
    .catch((error) => onPostSaveError?.(error))

  return result
}

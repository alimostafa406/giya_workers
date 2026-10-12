// Device event metadata is display-only. Never use a name to resolve identity.
export const safeBiometricDisplayName = (value) => {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (!name || [...name].some((character) => character.charCodeAt(0) < 32)
    || ['{', '}', '[', ']'].some((character) => name.includes(character))
    || /"\s*[:,]/u.test(name)) return ''
  return name
}

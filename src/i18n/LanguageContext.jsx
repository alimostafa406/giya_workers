import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { translations } from './translations'

const LANGUAGE_KEY = 'workers_app_language'
const supportedLanguages = new Set(['ar', 'en', 'fr'])
const LanguageContext = createContext(null)

const readLanguage = () => {
  const saved = localStorage.getItem(LANGUAGE_KEY)
  return supportedLanguages.has(saved) ? saved : 'ar'
}

const valueAtPath = (dictionary, key) => key.split('.').reduce((value, part) => value?.[part], dictionary)

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readLanguage)
  const direction = language === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = direction
    localStorage.setItem(LANGUAGE_KEY, language)
  }, [direction, language])

  const value = useMemo(() => ({
    language,
    direction,
    setLanguage: (next) => setLanguageState(supportedLanguages.has(next) ? next : 'ar'),
    t: (key, variables = {}) => {
      const translated = valueAtPath(translations[language], key) ?? valueAtPath(translations.en, key)
      if (typeof translated !== 'string') return import.meta.env.DEV ? key : ''
      return translated.replace(/\{(\w+)\}/g, (_, name) => variables[name] ?? `{${name}}`)
    },
  }), [direction, language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useTranslation = () => useContext(LanguageContext)
export { LANGUAGE_KEY }

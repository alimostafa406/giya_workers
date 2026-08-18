import { useTranslation } from '../i18n/LanguageContext'

export default function LanguageSwitcher() {
  const { language, setLanguage } = useTranslation()
  return <div className="flex overflow-hidden rounded-lg border border-(--border) bg-white text-xs font-extrabold">
    {[['ar', 'العربية'], ['en', 'EN'], ['fr', 'FR']].map(([code, label]) => <button key={code} type="button" onClick={() => setLanguage(code)} className={`px-2.5 py-2 ${language === code ? 'bg-(--primary) text-white' : 'text-(--muted) hover:bg-slate-50'}`}>{label}</button>)}
  </div>
}

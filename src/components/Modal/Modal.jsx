import { useTranslation } from '../../i18n/LanguageContext'

function Modal({ isOpen, title, onClose, children }) {
  const { t } = useTranslation()
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[1px]">
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-hidden rounded-2xl border border-(--border) bg-white shadow-[0_20px_60px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between border-b border-(--border) px-5 py-4">
          <h3 className="text-lg font-extrabold tracking-tight text-(--text)">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(--muted) transition hover:bg-slate-100 hover:text-(--text)">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export default Modal

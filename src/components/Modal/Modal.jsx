function Modal({ isOpen, title, onClose, children }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-(--border) bg-(--bg-soft) p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button type="button" onClick={onClose} className="btn-secondary px-3 py-1.5">
            إغلاق
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default Modal

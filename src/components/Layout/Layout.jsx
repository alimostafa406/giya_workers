import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from '../Navbar/Navbar'
import Sidebar from '../Sidebar/Sidebar'

function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-(--bg) lg:flex">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {isSidebarOpen ? (
        <button
          type="button"
          aria-label="إغلاق القائمة الجانبية"
          className="fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <main className="z-10 min-w-0 flex-1 p-4 sm:p-5 lg:p-7">
        <Navbar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <div className="mx-auto w-full max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default Layout

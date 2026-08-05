import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from '../Navbar/Navbar'
import Sidebar from '../Sidebar/Sidebar'

function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {isSidebarOpen ? (
        <button
          type="button"
          aria-label="close sidebar"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}

      <main className="z-10 flex-1 p-4 lg:p-6">
        <Navbar onOpenSidebar={() => setIsSidebarOpen(true)} />
        <Outlet />
      </main>
    </div>
  )
}

export default Layout

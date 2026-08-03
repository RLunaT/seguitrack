'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'

export default function LayoutClient({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* Top bar — solo visible en móvil */}
      <header className="flex md:hidden items-center gap-3 px-4 py-3 border-b border-gray-800 flex-shrink-0"
        style={{ background: '#0f172a' }}>
        <button
          onClick={() => setMobileOpen(true)}
          className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition-colors text-xl"
          aria-label="Abrir menú"
        >
          ☰
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-sm"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
            📋
          </div>
          <span className="text-sm font-bold text-white">SeguiTrack</span>
        </div>
      </header>

      {/* Contenido principal */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
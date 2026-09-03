'use client'
import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

export default function LayoutClient({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark'
    setTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Top bar móvil */}
      <header className="flex md:hidden items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ background: '#0d2d5e', borderBottom: '1px solid #1a4a8f' }}>
        <button onClick={() => setMobileOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-xl"
          style={{ color: 'rgba(255,255,255,0.7)' }}>
          ☰
        </button>
        <img src="/logo_electropuno.jpg" alt="Electro Puno" style={{ height: 28, borderRadius: 4 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>SeguiTrack</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}

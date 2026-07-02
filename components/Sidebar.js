'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Sidebar() {
  const pathname = usePathname()
  const [modulos, setModulos] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const asideRef  = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => { cargarModulos() }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const el  = activeRef.current
      const box = asideRef.current
      if (!el || !box) return
      const elRect  = el.getBoundingClientRect()
      const boxRect = box.getBoundingClientRect()
      const MARGEN  = 60
      const relTop    = elRect.top - boxRect.top + box.scrollTop
      const centrado  = relTop - box.clientHeight / 2 + el.offsetHeight / 2
      box.scrollTo({ top: Math.max(0, centrado), behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [pathname, modulos])

  async function cargarModulos() {
    const { data } = await supabase
      .from('modulos').select('id, nombre, icono, color')
      .eq('activo', true).order('orden')
    if (data) setModulos(data)
  }

  const navFijo = [
    { href: '/', icon: '📊', label: 'Dashboard General' },
    { href: '/gantt', icon: '📅', label: 'Gantt General' },
    { href: '/reportes', icon: '📋', label: 'Reportes' },
  ]
  const navConfig = [
    { href: '/configuracion', icon: '⚙️', label: 'Configuración' },
    { href: '/configuracion/contratistas', icon: '🏢', label: 'Contratistas' },
    { href: '/configuracion/notificaciones', icon: '🔔', label: 'Notificaciones' },
  ]
  const isActive = (href) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <aside
      ref={asideRef}
      className="flex flex-col border-r border-gray-800 transition-all duration-200 flex-shrink-0 overflow-y-auto"
      style={{ width: collapsed ? 52 : 230, background: '#0f172a' }}
    >
      {/* Logo — sticky para que no desaparezca al scrollear */}
      <div className="flex items-center gap-3 p-3 border-b border-gray-800 sticky top-0 z-10" style={{background:'#0f172a'}}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
          📋
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">SeguiTrack</div>
            <div className="text-xs text-gray-500 truncate">Sistema de Seguimiento</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-600 hover:text-gray-400 text-xs flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Nav fijo */}
      <div className="p-2">
        {navFijo.map(item => (
          <Link key={item.href} href={item.href}>
            <div ref={isActive(item.href) ? activeRef : null}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all text-sm
              ${isActive(item.href) ? 'bg-blue-950 text-blue-400 border border-blue-900' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}>
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="font-medium truncate text-xs">{item.label}</span>}
            </div>
          </Link>
        ))}
      </div>

      {/* Módulos */}
      <div className="px-2 flex-1">
        {!collapsed && <div className="text-xs font-bold text-gray-600 uppercase tracking-wider px-3 py-2">Módulos</div>}
        {modulos.map(mod => (
          <Link key={mod.id} href={`/modulo/${mod.id}`}>
            <div ref={isActive(`/modulo/${mod.id}`) ? activeRef : null}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all text-sm
              ${isActive(`/modulo/${mod.id}`) ? 'text-white border' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
              style={isActive(`/modulo/${mod.id}`) ? { background: `${mod.color}20`, borderColor: `${mod.color}40`, color: mod.color } : {}}>
              <span className="text-base flex-shrink-0">{mod.icono || '📋'}</span>
              {!collapsed && <span className="font-medium truncate text-xs">{mod.nombre}</span>}
            </div>
          </Link>
        ))}
        <Link href="/configuracion/modulos/nuevo">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg mb-1 cursor-pointer text-sm text-gray-600 hover:text-blue-400 border border-dashed border-gray-800 hover:border-blue-800 transition-all mt-2">
            <span className="text-base flex-shrink-0">➕</span>
            {!collapsed && <span className="text-xs">Crear módulo</span>}
          </div>
        </Link>
      </div>

      {/* Config */}
      <div className="p-2 border-t border-gray-800">
        {!collapsed && <div className="text-xs font-bold text-gray-600 uppercase tracking-wider px-3 py-2">Sistema</div>}
        {navConfig.map(item => (
          <Link key={item.href} href={item.href}>
            <div ref={isActive(item.href) ? activeRef : null}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all text-xs
              ${isActive(item.href) ? 'bg-blue-950 text-blue-400' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}>
              <span className="text-sm flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </div>
          </Link>
        ))}
      </div>
    </aside>
  )
}
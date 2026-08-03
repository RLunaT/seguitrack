'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function Sidebar({ mobileOpen, onMobileClose }) {
  const pathname      = usePathname()
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const periodoActivo = searchParams.get('periodo')

  const [modulos,  setModulos]  = useState([])
  const [periodos, setPeriodos] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  const [periodosAbiertos, setPeriodosAbiertos] = useState({})
  const [modalNuevoPeriodo, setModalNuevoPeriodo] = useState(false)
  const [nuevoPeriodo, setNuevoPeriodo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [modulosSeleccionados, setModulosSeleccionados] = useState([])
  const asideRef  = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => { cargarDatos() }, [])

  useEffect(() => {
    if (onMobileClose) onMobileClose()
  }, [pathname, periodoActivo])

  useEffect(() => {
    const timer = setTimeout(() => {
      const el  = activeRef.current
      const box = asideRef.current
      if (!el || !box) return
      const relTop   = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
      const centrado = relTop - box.clientHeight / 2 + el.offsetHeight / 2
      box.scrollTo({ top: Math.max(0, centrado), behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [pathname, periodoActivo, modulos, periodos])

  async function cargarDatos() {
    // Cargar módulos
    const { data: mods } = await supabase
      .from('modulos')
      .select('id, nombre, icono, color, periodo')
      .eq('activo', true)
      .order('orden')

    // Períodos desde OTs
    const { data: otsData } = await supabase
      .from('ots')
      .select('periodo')

    const periodosDeOts = new Set(
      (otsData || []).map(o => o.periodo).filter(Boolean)
    )

    // Períodos guardados en config_global (incluye los que aún no tienen OTs)
    const { data: cfgData } = await supabase
      .from('config_global')
      .select('valor')
      .eq('clave', 'periodos_lista')
      .single()

    const periodosGuardados = cfgData?.valor
      ? cfgData.valor.split(',').map(p => p.trim()).filter(Boolean)
      : []

    // Unir ambas fuentes y ordenar
    const todosLosPeriodos = [
      ...new Set([...periodosDeOts, ...periodosGuardados])
    ].sort((a, b) => {
      // Ordenar por año desc, luego semestre desc (II > I)
      const parseP = p => {
        const m = String(p).match(/^(\d{4})-(I{1,2})$/)
        if (!m) return [0, 0]
        return [parseInt(m[1]), m[2] === 'II' ? 2 : 1]
      }
      const [ya, sa] = parseP(a)
      const [yb, sb] = parseP(b)
      return yb !== ya ? yb - ya : sb - sa
    })

    setModulos(mods || [])
    setPeriodos(todosLosPeriodos)

    // Abrir el período activo o el primero
    const estado = {}
    todosLosPeriodos.forEach((p, i) => {
      estado[p] = periodoActivo ? p === periodoActivo : i === 0
    })
    setPeriodosAbiertos(estado)
  }

  function togglePeriodo(p) {
    setPeriodosAbiertos(prev => ({ ...prev, [p]: !prev[p] }))
  }

  async function eliminarPeriodo(p) {
    if (!confirm(`¿Eliminar el período ${p}? Se eliminarán también sus módulos (no las OTs).`)) return
    
    // Eliminar módulos de ese período
    await supabase.from('modulos').delete().eq('periodo', p)
    
    // Quitar de config_global
    const nuevosPeriodos = periodos.filter(x => x !== p)
    await supabase
      .from('config_global')
      .upsert({ clave: 'periodos_lista', valor: nuevosPeriodos.join(','), descripcion: 'Lista de períodos del sistema' })

    setPeriodos(nuevosPeriodos)
    setPeriodosAbiertos(prev => { const n = {...prev}; delete n[p]; return n })
  }

  async function crearPeriodo() {
    const p = nuevoPeriodo.trim().toUpperCase()
    if (!p) return
    // Validar formato YYYY-I o YYYY-II
    if (!/^\d{4}-(I|II)$/.test(p)) {
      alert('Formato inválido. Usa: 2026-I o 2026-II')
      return
    }
    if (periodos.includes(p)) {
      alert(`El período ${p} ya existe.`)
      return
    }
    if (modulosSeleccionados.length === 0) {
      alert('Selecciona al menos un módulo.')
      return
    }
    setGuardando(true)

    // Duplicar los módulos seleccionados para el nuevo período (sin OTs)
    const modulosADuplicar = modulos.filter(m => modulosSeleccionados.includes(m.id))
    const inserts = modulosADuplicar.map(m => ({
      nombre:              m.nombre,
      icono:               m.icono,
      color:               m.color,
      periodo:             p,
      activo:              true,
      orden:               m.orden ?? 99,
    }))

    // Traer datos completos de los módulos a duplicar
    const { data: modsCompletos } = await supabase
      .from('modulos')
      .select('*')
      .in('id', modulosSeleccionados)

    const insertsCompletos = (modsCompletos || []).map(m => ({
      nombre:                 m.nombre,
      descripcion:            m.descripcion,
      icono:                  m.icono,
      color:                  m.color,
      tipo:                   m.tipo,
      actividades:            m.actividades,
      motivos:                m.motivos,
      plantilla_titulo:       m.plantilla_titulo,
      plantilla_cumplimiento: m.plantilla_cumplimiento,
      plantilla_actividad:    m.plantilla_actividad,
      plantilla_editado_por:  m.plantilla_editado_por,
      tiene_penalidad:        m.tiene_penalidad,
      periodo:                p,
      activo:                 true,
      orden:                  m.orden ?? 99,
    }))

    await supabase.from('modulos').insert(insertsCompletos)

    // Guardar período en config_global
    const nuevosPeriodos = [...new Set([...periodos, p])].sort((a, b) => b.localeCompare(a))
    await supabase
      .from('config_global')
      .upsert({ clave: 'periodos_lista', valor: nuevosPeriodos.join(','), descripcion: 'Lista de períodos del sistema' })

    setPeriodos(nuevosPeriodos)
    setPeriodosAbiertos(prev => ({ ...prev, [p]: true }))
    setModalNuevoPeriodo(false)
    setNuevoPeriodo('')
    setModulosSeleccionados([])
    setGuardando(false)

    // Recargar módulos
    await cargarDatos()
  }

  const isModuloActivo = (modId, p) =>
    pathname === `/modulo/${modId}` && (periodoActivo === p || (!periodoActivo && modulos.find(m => m.id === modId)?.periodo === p))

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

  const sidebarContent = (
    <aside
      ref={asideRef}
      className="flex flex-col h-full border-r border-gray-800 transition-all duration-200 overflow-y-auto"
      style={{ width: collapsed ? 52 : 230, background: '#0f172a' }}
    >
      {/* Logo */}
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
        <button onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex text-gray-600 hover:text-gray-400 text-xs flex-shrink-0 w-6 h-6 items-center justify-center rounded hover:bg-gray-800">
          {collapsed ? '→' : '←'}
        </button>
        {onMobileClose && (
          <button onClick={onMobileClose}
            className="flex md:hidden text-gray-500 hover:text-gray-300 flex-shrink-0 w-7 h-7 items-center justify-center rounded hover:bg-gray-800 text-lg">
            ✕
          </button>
        )}
      </div>

      {/* Nav fijo */}
      <div className="p-2">
        {navFijo.map(item => (
          <Link key={item.href} href={item.href}>
            <div ref={isActive(item.href) && !pathname.startsWith('/modulo') ? activeRef : null}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-all
              ${isActive(item.href) && !pathname.startsWith('/modulo')
                ? 'bg-blue-950 text-blue-400 border border-blue-900'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}>
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="font-medium truncate text-xs">{item.label}</span>}
            </div>
          </Link>
        ))}
      </div>

      {/* Módulos por período */}
      <div className="px-2 flex-1">
        {!collapsed && (
          <div className="text-xs font-bold text-gray-600 uppercase tracking-wider px-3 py-2">Módulos</div>
        )}

        {periodos.map(p => {
          const abierto     = periodosAbiertos[p]
          const tieneActivo = modulos.some(m => isModuloActivo(m.id, p))

          return (
            <div key={p} className="mb-1">
              <button
                onClick={() => togglePeriodo(p)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-left
                  ${tieneActivo ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
              >
                {!collapsed ? (
                  <>
                    <span className="text-xs font-bold tracking-wide flex-1">{p}</span>
                    <div
                      onClick={e => { e.stopPropagation(); eliminarPeriodo(p) }}
                      className="text-gray-700 hover:text-red-400 transition-colors mr-1 text-xs cursor-pointer"
                      title="Eliminar período"
                    >✕</div>
                    <span className="text-xs opacity-50">{abierto ? '▾' : '▸'}</span>
                  </>
                ) : (
                  <span className="text-xs font-bold">{p.slice(-1)}</span>
                )}
              </button>

              {(abierto || collapsed) && modulos.filter(m => m.periodo === p).map(mod => {
                const activo = isModuloActivo(mod.id, p)
                return (
                  <Link key={mod.id} href={`/modulo/${mod.id}?periodo=${p}`}>
                    <div
                      ref={activo ? activeRef : null}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-0.5 cursor-pointer transition-all
                        ${!collapsed ? 'ml-2' : ''}
                        ${activo ? 'text-white border' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                      style={activo
                        ? { background: `${mod.color}20`, borderColor: `${mod.color}40`, color: mod.color }
                        : {}}
                    >
                      <span className="text-base flex-shrink-0">{mod.icono || '📋'}</span>
                      {!collapsed && <span className="font-medium truncate text-xs">{mod.nombre}</span>}
                    </div>
                  </Link>
                )
              })}

              {/* Crear módulo dentro del período */}
              {(abierto || collapsed) && (
                <Link href={`/configuracion/modulos/nuevo?periodo=${p}`}>
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-0.5 cursor-pointer text-gray-600 hover:text-blue-400 border border-dashed border-gray-800 hover:border-blue-800 transition-all ${!collapsed ? 'ml-2' : ''}`}>
                    <span className="text-base flex-shrink-0">➕</span>
                    {!collapsed && <span className="text-xs">Crear módulo</span>}
                  </div>
                </Link>
              )}
            </div>
          )
        })}

        {/* Nuevo período */}
        <button
          onClick={() => { setModulosSeleccionados(modulos.map(m => m.id)); setModalNuevoPeriodo(true) }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-gray-600 hover:text-blue-400 border border-dashed border-gray-800 hover:border-blue-800 transition-all mt-1"
        >
          <span className="text-base flex-shrink-0">📅</span>
          {!collapsed && <span className="text-xs">Nuevo período</span>}
        </button>


      </div>

      {/* Sistema */}
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

  return (
    <>
      <div className="hidden md:flex h-full flex-shrink-0">
        {sidebarContent}
      </div>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onMobileClose} />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            {sidebarContent}
          </div>
        </>
      )}

      {/* Modal nuevo período */}
      {modalNuevoPeriodo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-xl p-6 shadow-xl" style={{background:'#0f172a', border:'1px solid #1e293b', width: 340}}>
            <div className="text-sm font-bold text-white mb-1">Nuevo período</div>
            <div className="text-xs text-gray-500 mb-3">Ej: 2026-II, 2027-I, 2027-II</div>

            <input
              autoFocus
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-4"
              placeholder="2026-II"
              value={nuevoPeriodo}
              onChange={e => setNuevoPeriodo(e.target.value.toUpperCase())}
            />

            <div className="text-xs font-semibold text-gray-400 mb-2">Módulos a incluir</div>
            <div className="flex flex-col gap-1 mb-4 max-h-48 overflow-y-auto">
              {modulos.filter((m, i, arr) =>
                arr.findIndex(x => x.nombre === m.nombre) === i
              ).map(mod => (
                <label key={mod.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                  <input
                    type="checkbox"
                    className="accent-blue-500"
                    checked={modulosSeleccionados.includes(mod.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setModulosSeleccionados(prev => [...prev, mod.id])
                      } else {
                        setModulosSeleccionados(prev => prev.filter(id => id !== mod.id))
                      }
                    }}
                  />
                  <span className="text-base">{mod.icono}</span>
                  <span className="text-xs text-gray-300">{mod.nombre}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setModalNuevoPeriodo(false); setNuevoPeriodo(''); setModulosSeleccionados([]) }}
                className="flex-1 px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-all">
                Cancelar
              </button>
              <button
                onClick={crearPeriodo}
                disabled={guardando || !nuevoPeriodo.trim() || modulosSeleccionados.length === 0}
                className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)'}}>
                {guardando ? 'Creando...' : 'Crear período'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
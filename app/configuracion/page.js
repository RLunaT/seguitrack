'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function ConfigPage() {
  const router = useRouter()
  const [config, setConfig] = useState({})
  const [modulos, setModulos] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [papeleraModulos, setPapeleraModulos] = useState([])
  const [papeleraOts, setPapeleraOts] = useState([])
  const [loadingPapelera, setLoadingPapelera] = useState(false)
  const [mostrarPapelera, setMostrarPapelera] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: cfg }, { data: mods }] = await Promise.all([
      supabase.from('config_global').select('*'),
      supabase.from('modulos').select('*').is('deleted_at', null).order('periodo', {ascending: false}).order('orden'),
    ])
    const cfgMap = {}
    cfg?.forEach(c => { cfgMap[c.clave] = c.valor })
    setConfig(cfgMap)
    setModulos(mods || [])
  }

  async function guardarConfig() {
    setSaving(true)
    for (const [clave, valor] of Object.entries(config)) {
      await supabase.from('config_global').upsert({ clave, valor }, { onConflict: 'clave' })
    }
    setSaving(false)
    setMsg('✅ Configuración guardada')
    setTimeout(() => setMsg(''), 3000)
  }

  async function toggleModulo(id, activo) {
    await supabase.from('modulos').update({ activo: !activo }).eq('id', id)
    cargar()
  }

  async function eliminarModulo(id, nombre) {
    if (!confirm(`¿Mover "${nombre}" a la papelera? Podrás restaurarlo durante 10 días.`)) return
    const ahora = new Date().toISOString()
    await supabase.from('ots').update({ deleted_at: ahora }).eq('modulo_id', id).is('deleted_at', null)
    await supabase.from('modulos').update({ deleted_at: ahora }).eq('id', id)
    cargar()
  }

  async function cargarPapelera() {
    setLoadingPapelera(true)
    const [{ data: mods }, { data: ots }] = await Promise.all([
      supabase.from('modulos').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
      supabase.from('ots').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    ])
    const modMap = Object.fromEntries((mods || []).map(m => [m.id, m]))
    setPapeleraModulos(mods || [])
    const modIdsEliminados = new Set((mods || []).map(m => m.id))
    setPapeleraOts((ots || []).filter(o => !modIdsEliminados.has(o.modulo_id)))
    setLoadingPapelera(false)
  }

  async function restaurarModulo(mod) {
    await supabase.from('modulos').update({ deleted_at: null }).eq('id', mod.id)
    await supabase.from('ots').update({ deleted_at: null }).eq('modulo_id', mod.id).not('deleted_at', 'is', null)
    cargarPapelera(); cargar()
  }

  async function eliminarModuloDefinitivo(mod) {
    if (!confirm(`¿Eliminar permanentemente "${mod.nombre}" y todas sus OTs? Esto no se puede deshacer.`)) return
    await supabase.from('ots').delete().eq('modulo_id', mod.id)
    await supabase.from('modulo_campos').delete().eq('modulo_id', mod.id)
    await supabase.from('modulos').delete().eq('id', mod.id)
    cargarPapelera()
  }

  async function restaurarOtSuelta(id_ot) {
    await supabase.from('ots').update({ deleted_at: null }).eq('id', id_ot)
    cargarPapelera()
  }

  async function eliminarOtDefinitiva(id_ot) {
    if (!confirm('¿Eliminar permanentemente esta OT?')) return
    await supabase.from('ots').delete().eq('id', id_ot)
    cargarPapelera()
  }

  function diasRestantes(deleted_at) {
    const expira = new Date(new Date(deleted_at).getTime() + 10 * 24 * 60 * 60 * 1000)
    return Math.max(0, Math.ceil((expira - new Date()) / (24 * 60 * 60 * 1000)))
  }

  const totalPapelera = papeleraModulos.length + papeleraOts.length

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold text-white mb-2">⚙️ Configuración del Sistema</h1>
      <p className="text-gray-400 text-sm mb-6">Parámetros globales y gestión de módulos</p>

      {/* Config global */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">🌐 Parámetros Globales</h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'periodo', label: 'Periodo actual', placeholder: '2026-I', help: 'Se usa en el nombre de OTs y documentos' },
            { key: 'año_semanas', label: 'Año para semanas', placeholder: '2026', help: 'Año base para el selector de semanas' },
            { key: 'empresa', label: 'Empresa usuaria', placeholder: 'ELECTROPUNO S.A.A', help: 'Aparece en documentos generados' },
            { key: 'area', label: 'Área / Cargo editado por', placeholder: 'ANALISTA DE NORMALIZACIÓN...', help: 'Aparece en OTs generadas' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-gray-400 block mb-1">{f.label}</label>
              <input
                className="input-base"
                placeholder={f.placeholder}
                value={config[f.key] || ''}
                onChange={e => setConfig(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
              <p className="text-xs text-gray-600 mt-1">{f.help}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button className="btn-primary" onClick={guardarConfig} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar configuración'}
          </button>
          {msg && <span className="text-sm text-green-400">{msg}</span>}
        </div>
      </div>

      {/* Módulos */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-300">📁 Módulos del Sistema</h2>
          <button className="btn-primary text-xs" onClick={() => router.push('/configuracion/modulos/nuevo')}>
            + Nuevo Módulo
          </button>
        </div>
        <div className="space-y-4">
          {(() => {
            const grupos = modulos.reduce((acc, mod) => {
              const p = mod.periodo || 'Sin período'
              if (!acc[p]) acc[p] = []
              acc[p].push(mod)
              return acc
            }, {})
            const periodos = Object.keys(grupos).sort((a, b) => {
              const parseP = p => { const m = String(p).match(/^(\d{4})-(I{1,2})$/); return m ? [parseInt(m[1]), m[2]==='II'?2:1] : [0,0] }
              const [ya,sa] = parseP(a); const [yb,sb] = parseP(b)
              return yb !== ya ? yb - ya : sb - sa
            })
            return periodos.map(periodo => (
              <div key={periodo}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{periodo}</span>
                  <div className="flex-1 h-px bg-gray-800"/>
                  <span className="text-xs text-gray-600">{grupos[periodo].length} módulos</span>
                </div>
                <div className="space-y-2">
                  {grupos[periodo].map(mod => (
                    <div key={mod.id} className="flex items-center gap-4 p-3 rounded-lg border border-gray-800 bg-gray-900">
                      <div className="text-xl flex-shrink-0">{mod.icono}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-200">{mod.nombre}</div>
                        <div className="text-xs text-gray-500 truncate">{mod.descripcion}</div>
                        <div className="flex gap-2 mt-1">
                          <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">{mod.tipo}</span>
                          {!mod.activo && <span className="text-xs bg-red-950 text-red-400 px-2 py-0.5 rounded">Inactivo</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button className="btn-ghost text-xs py-1 px-2"
                          onClick={() => router.push(`/configuracion/modulos/${mod.id}`)}>
                          ✏️ Editar
                        </button>
                        <button className="btn-ghost text-xs py-1 px-2"
                          onClick={() => toggleModulo(mod.id, mod.activo)}>
                          {mod.activo ? '🔕 Desactivar' : '🔔 Activar'}
                        </button>
                        <button className="btn-danger text-xs py-1 px-2"
                          onClick={() => eliminarModulo(mod.id, mod.nombre)}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()}
        </div>
      </div>

      {/* Papelera */}
      <div className="card">
        <button
          className="w-full flex items-center justify-between"
          onClick={() => { setMostrarPapelera(p => { const next = !p; if (next) cargarPapelera(); return next }) }}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-300">🗑️ Papelera</h2>
            {totalPapelera > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#450a0a', color: '#f87171' }}>
                {totalPapelera}
              </span>
            )}
          </div>
          <span className="text-gray-600 text-xs">{mostrarPapelera ? '▲ Ocultar' : '▼ Ver papelera'}</span>
        </button>

        {mostrarPapelera && (
          <div className="mt-4 space-y-5">
            <p className="text-xs text-gray-500">Los elementos se eliminan definitivamente tras 10 días. Puedes restaurarlos o borrarlos antes.</p>

            {loadingPapelera && <div className="text-xs text-gray-500 py-4 text-center">Cargando...</div>}

            {!loadingPapelera && papeleraModulos.length === 0 && papeleraOts.length === 0 && (
              <div className="text-xs text-gray-600 py-6 text-center">La papelera está vacía.</div>
            )}

            {/* Módulos eliminados */}
            {!loadingPapelera && papeleraModulos.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Módulos eliminados</h3>
                <div className="space-y-2">
                  {papeleraModulos.map(mod => {
                    const d = diasRestantes(mod.deleted_at)
                    return (
                      <div key={mod.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-800" style={{ background: '#0d1526' }}>
                        <div className="text-lg flex-shrink-0">{mod.icono}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-gray-300">{mod.nombre}</div>
                          <div className="text-xs text-gray-600">{mod.periodo} · Eliminado el {new Date(mod.deleted_at).toLocaleDateString('es-PE')}</div>
                        </div>
                        <span className={`text-xs font-semibold flex-shrink-0 ${d <= 2 ? 'text-red-400' : d <= 5 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {d}d
                        </span>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button onClick={() => restaurarModulo(mod)}
                            className="px-2.5 py-1 rounded text-xs font-semibold"
                            style={{ background: '#0e7490', color: '#fff' }}>
                            ↩ Restaurar
                          </button>
                          <button onClick={() => eliminarModuloDefinitivo(mod)}
                            className="px-2.5 py-1 rounded text-xs font-semibold"
                            style={{ background: '#1e293b', color: '#ef4444', border: '1px solid #450a0a' }}>
                            Borrar ya
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* OTs sueltas */}
            {!loadingPapelera && papeleraOts.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">OTs eliminadas individualmente</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2 px-3 font-medium">N° OT</th>
                        <th className="text-left py-2 px-3 font-medium">Módulo</th>
                        <th className="text-left py-2 px-3 font-medium">Actividad</th>
                        <th className="text-left py-2 px-3 font-medium">Eliminado</th>
                        <th className="text-left py-2 px-3 font-medium">Expira</th>
                        <th className="text-right py-2 px-3 font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {papeleraOts.map(ot => {
                        const d = diasRestantes(ot.deleted_at)
                        return (
                          <tr key={ot.id} className="border-b border-gray-900 hover:bg-gray-900 transition-colors">
                            <td className="py-2 px-3 font-mono text-gray-300">{String(ot.numero_ot || ot.numero_registro || '').padStart(2,'0')}</td>
                            <td className="py-2 px-3 text-gray-400">{modulos.find(m => m.id === ot.modulo_id)?.nombre || `Módulo ${ot.modulo_id}`}</td>
                            <td className="py-2 px-3 text-gray-400">{ot.actividad || '—'}</td>
                            <td className="py-2 px-3 text-gray-500">{new Date(ot.deleted_at).toLocaleDateString('es-PE')}</td>
                            <td className="py-2 px-3">
                              <span className={`font-semibold ${d <= 2 ? 'text-red-400' : d <= 5 ? 'text-yellow-400' : 'text-gray-500'}`}>{d}d</span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex gap-1.5 justify-end">
                                <button onClick={() => restaurarOtSuelta(ot.id)}
                                  className="px-2.5 py-1 rounded text-xs font-semibold"
                                  style={{ background: '#0e7490', color: '#fff' }}>
                                  ↩ Restaurar
                                </button>
                                <button onClick={() => eliminarOtDefinitiva(ot.id)}
                                  className="px-2.5 py-1 rounded text-xs font-semibold"
                                  style={{ background: '#1e293b', color: '#ef4444', border: '1px solid #450a0a' }}>
                                  Borrar ya
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

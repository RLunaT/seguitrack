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

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: cfg }, { data: mods }] = await Promise.all([
      supabase.from('config_global').select('*'),
      supabase.from('modulos').select('*').order('periodo', {ascending: false}).order('orden'),
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
    if (!confirm(`¿Eliminar el módulo "${nombre}"? Se eliminarán todas sus OTs.`)) return
    await supabase.from('ots').delete().eq('modulo_id', id)
    await supabase.from('modulo_campos').delete().eq('modulo_id', id)
    await supabase.from('modulos').delete().eq('id', id)
    cargar()
  }

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
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-300">📁 Módulos del Sistema</h2>
          <button className="btn-primary text-xs" onClick={() => router.push('/configuracion/modulos/nuevo')}>
            + Nuevo Módulo
          </button>
        </div>
        <div className="space-y-4">
          {(() => {
            // Agrupar módulos por período
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
    </div>
  )
}
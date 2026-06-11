'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const COLORES_DEFAULT = ['#3b82f6','#22c55e','#f97316','#a855f7','#f59e0b','#ec4899','#14b8a6','#ef4444']

export default function ContratistasPage() {
  const [contratistas, setContratistas] = useState([])
  const [modulos, setModulos]           = useState([])
  const [relaciones, setRelaciones]     = useState([])
  const [vista, setVista]               = useState('modulos') // 'modulos' | 'lista'
  const [modalOpen, setModalOpen]       = useState(false)
  const [editando, setEditando]         = useState(null)
  const [form, setForm]                 = useState({ nombre:'', contrato:'', zona:'', tasa_penalidad:'', color:'#3b82f6' })
  const [modulosSelec, setModulosSelec] = useState([])
  const [saving, setSaving]             = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: cs }, { data: ms }, { data: rels }] = await Promise.all([
      supabase.from('contratistas').select('*').eq('activo', true).order('nombre'),
      supabase.from('modulos').select('id,nombre,icono,tipo').eq('activo', true).order('orden'),
      supabase.from('contratista_modulos').select('contratista_id, modulo_id, orden'),
    ])
    setContratistas(cs || [])
    setModulos(ms || [])
    setRelaciones(rels || [])
  }

  function modulosDeContratista(cid) {
    return relaciones.filter(r => r.contratista_id === cid).map(r => r.modulo_id)
  }

  function contratistasDelModulo(mid) {
    const rels = relaciones.filter(r => r.modulo_id === mid)
    return rels
      .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
      .map(r => contratistas.find(c => c.id === r.contratista_id))
      .filter(Boolean)
  }

  // Extraer zona/ítem del nombre del contratista
  function parseNombre(nombre) {
    const itemMatch = nombre.match(/[–-]\s*[ÍI]tem\s*(\d+)/i)
    const item = itemMatch ? `Ítem ${itemMatch[1]}` : null
    const base = nombre.replace(/\s*[–-]\s*[ÍI]tem\s*\d+/i, '').trim()
    return { base, item }
  }

  function abrir(c = null) {
    setEditando(c)
    if (c) {
      setForm({ nombre: c.nombre, contrato: c.contrato||'', zona: c.zona||'', tasa_penalidad: c.tasa_penalidad||'', color: c.color||'#3b82f6' })
      setModulosSelec(modulosDeContratista(c.id))
    } else {
      setForm({ nombre:'', contrato:'', zona:'', tasa_penalidad:'', color: COLORES_DEFAULT[contratistas.length % COLORES_DEFAULT.length] })
      setModulosSelec([])
    }
    setModalOpen(true)
  }

  function toggleModulo(mid) {
    setModulosSelec(prev => prev.includes(mid) ? prev.filter(x => x !== mid) : [...prev, mid])
  }

  async function guardar() {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      contrato: form.contrato.trim() || null,
      zona: form.zona.trim() || null,
      tasa_penalidad: parseFloat(form.tasa_penalidad) || 0,
      color: form.color,
      activo: true,
    }
    let cid = editando?.id
    if (editando) {
      await supabase.from('contratistas').update(payload).eq('id', cid)
    } else {
      const { data } = await supabase.from('contratistas').insert(payload).select().single()
      cid = data?.id
    }
    if (cid) {
      await supabase.from('contratista_modulos').delete().eq('contratista_id', cid)
      if (modulosSelec.length > 0) {
        await supabase.from('contratista_modulos').insert(
          modulosSelec.map(mid => ({ contratista_id: cid, modulo_id: mid }))
        )
      }
    }
    setSaving(false)
    setModalOpen(false)
    cargar()
  }

  async function eliminar(id, nombre) {
    if (!confirm(`¿Eliminar "${nombre}"? Las OTs asociadas quedarán sin contratista.`)) return
    await supabase.from('contratistas').update({ activo: false }).eq('id', id)
    cargar()
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">🏢 Contratistas</h1>
          <p className="text-gray-400 text-sm mt-1">{contratistas.length} empresa{contratistas.length !== 1 ? 's' : ''} registradas</p>
        </div>
        <div className="flex gap-2">
          {/* Toggle vista */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button onClick={() => setVista('modulos')}
              className={`text-xs px-3 py-1.5 transition-all ${vista==='modulos' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Por módulo
            </button>
            <button onClick={() => setVista('lista')}
              className={`text-xs px-3 py-1.5 transition-all ${vista==='lista' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Lista completa
            </button>
          </div>
          <button className="btn-primary text-sm" onClick={() => abrir()}>+ Nuevo</button>
        </div>
      </div>

      {/* ── VISTA POR MÓDULO ── */}
      {vista === 'modulos' && (
        <div className="space-y-5">
          {modulos.filter(m => m.tipo === 'ot').map(mod => {
            const cs = contratistasDelModulo(mod.id)
            return (
              <div key={mod.id} className="card p-0 overflow-hidden">
                {/* Header del módulo */}
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between"
                  style={{ background: '#111827' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{mod.icono}</span>
                    <span className="text-sm font-bold text-white">{mod.nombre}</span>
                    <span className="text-xs text-gray-500 ml-1">{cs.length} contratista{cs.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {cs.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-600 text-sm">
                    Sin contratistas asignados a este módulo
                  </div>
                ) : (
                  <table className="w-full" style={{ fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#0f172a' }}>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide" style={{ width: 40 }}>#</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Empresa</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Contrato</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Zona</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Penalidad</th>
                        <th className="px-4 py-2 text-gray-500 font-semibold uppercase text-xs tracking-wide" style={{ width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cs.map((c, i) => {
                        const { base, item } = parseNombre(c.nombre)
                        return (
                          <tr key={c.id} className="border-t border-gray-800 hover:bg-gray-900 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color || '#6b7280' }}/>
                                <span className="text-gray-500">{i + 1}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-gray-100 font-medium">{base}</div>
                              {item && <div className="text-gray-500 text-xs mt-0.5">{item}</div>}
                            </td>
                            <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.contrato || '—'}</td>
                            <td className="px-4 py-3 text-gray-400">{c.zona || '—'}</td>
                            <td className="px-4 py-3 text-gray-400 font-mono">
                              {c.tasa_penalidad ? `S/ ${c.tasa_penalidad}/día` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1 justify-end">
                                <button className="btn-ghost text-xs py-1 px-2" onClick={() => abrir(c)}>✏️</button>
                                <button className="btn-ghost text-xs py-1 px-2 text-red-500 hover:text-red-400" onClick={() => eliminar(c.id, c.nombre)}>🗑️</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── VISTA LISTA COMPLETA ── */}
      {vista === 'lista' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full" style={{ fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#111827' }}>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Empresa</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Contrato</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Zona</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Módulos</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Penalidad</th>
                <th className="px-4 py-3" style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {contratistas.map(c => {
                const mods = modulos.filter(m => modulosDeContratista(c.id).includes(m.id))
                const { base, item } = parseNombre(c.nombre)
                return (
                  <tr key={c.id} className="border-t border-gray-800 hover:bg-gray-900 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color || '#6b7280' }}/>
                        <div>
                          <div className="text-gray-100 font-medium">{base}</div>
                          {item && <div className="text-gray-500 text-xs">{item}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.contrato || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{c.zona || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {mods.length === 0
                          ? <span className="text-gray-600 text-xs italic">Sin módulos</span>
                          : mods.map(m => (
                              <span key={m.id} className="text-xs px-2 py-0.5 rounded-full border border-gray-700 text-gray-400">
                                {m.icono} {m.nombre}
                              </span>
                            ))
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                      {c.tasa_penalidad ? `S/ ${c.tasa_penalidad}/día` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button className="btn-ghost text-xs py-1 px-2" onClick={() => abrir(c)}>✏️</button>
                        <button className="btn-ghost text-xs py-1 px-2 text-red-500 hover:text-red-400" onClick={() => eliminar(c.id, c.nombre)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-bold text-white">
                  {editando ? '✏️ Editar Contratista' : '+ Nuevo Contratista'}
                </h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre de la empresa *</label>
                <input className="input-base" placeholder="Ej: CONSORCIO ENERGAL – Ítem 1"
                  value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Número de contrato</label>
                  <input className="input-base" placeholder="N.° 05-2026-ELPU/GG"
                    value={form.contrato} onChange={e => setForm(p => ({ ...p, contrato: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Zona / Provincia</label>
                  <input className="input-base" placeholder="Ej: Puno, Azángaro..."
                    value={form.zona} onChange={e => setForm(p => ({ ...p, zona: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Tasa penalidad (S//día)</label>
                  <input className="input-base" type="number" min="0" step="0.01" placeholder="0.00"
                    value={form.tasa_penalidad} onChange={e => setForm(p => ({ ...p, tasa_penalidad: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" className="w-9 h-9 rounded cursor-pointer border border-gray-700 bg-transparent"
                      value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} />
                    <div className="flex gap-1 flex-wrap">
                      {COLORES_DEFAULT.map(c => (
                        <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))}
                          className="w-5 h-5 rounded-full border-2 transition-all"
                          style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent' }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-2">Módulos asignados</label>
                <div className="grid grid-cols-2 gap-2">
                  {modulos.map(m => (
                    <label key={m.id} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${modulosSelec.includes(m.id) ? 'border-blue-600 bg-blue-950' : 'border-gray-800 hover:border-gray-700'}`}>
                      <input type="checkbox" className="accent-blue-500"
                        checked={modulosSelec.includes(m.id)}
                        onChange={() => toggleModulo(m.id)} />
                      <span className="text-xs">{m.icono} {m.nombre}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar} disabled={saving || !form.nombre.trim()}>
                {saving ? '⏳ Guardando...' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const COLORES_DEFAULT = ['#3b82f6','#22c55e','#f97316','#a855f7','#f59e0b','#ec4899','#14b8a6','#ef4444']
const DIAS_POR_VENCER = 30

// Nombre "familia" del módulo, sin el sufijo de período (ej: "Contrastes de Medidores 2026-II" -> "Contrastes de Medidores")
function nombreBase(nombre) {
  return nombre.replace(/\s*20\d{2}-(I{1,2})\s*$/i, '').trim()
}
function claveGrupo(nombre) {
  return nombreBase(nombre).toLowerCase()
}

export default function ContratistasPage() {
  const [contratistas, setContratistas] = useState([])
  const [modulos, setModulos]           = useState([])
  const [relaciones, setRelaciones]     = useState([]) // contratista_modulos: id/orden por módulo-período
  const [historial, setHistorial]       = useState([]) // contratos_historial: contratos por FAMILIA (modulo_id = id ancla)
  const [vista, setVista]               = useState('modulos') // 'modulos' | 'lista'
  const [modalOpen, setModalOpen]       = useState(false)
  const [editando, setEditando]         = useState(null)
  const [form, setForm]                 = useState({ nombre:'', zona:'', color:'#3b82f6' })
  // modulosSelec: [{ clave, contratos: [{id?, numero_contrato, tasa_penalidad, fecha_inicio, fecha_fin}] }]
  const [modulosSelec, setModulosSelec] = useState([])
  const [saving, setSaving]             = useState(false)
  const [historialAbierto, setHistorialAbierto] = useState({}) // { [clave]: bool }

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: cs }, { data: ms }, { data: rels }, { data: hist }] = await Promise.all([
      supabase.from('contratistas').select('*').eq('activo', true).order('nombre'),
      supabase.from('modulos').select('id,nombre,icono,tipo,periodo,orden').eq('activo', true).order('orden'),
      supabase.from('contratista_modulos').select('id, contratista_id, modulo_id, orden'),
      supabase.from('contratos_historial').select('*').order('fecha_inicio', { ascending: false, nullsFirst: false }),
    ])
    setContratistas(cs || [])
    setModulos(ms || [])
    setRelaciones(rels || [])
    setHistorial(hist || [])
  }

  // ── Familias de módulo (agrupan todos los períodos del mismo módulo) ──
  // Los módulos tipo 'ot' se agrupan por nombre base (familia por período).
  // Los módulos tipo 'inst' son su propia familia — no tienen períodos, son únicos.
  function idsDeFamilia(clave) {
    const esInst = modulos.some(m => m.tipo === 'inst' && claveGrupo(m.nombre) === clave)
    if (esInst) return modulos.filter(m => m.tipo === 'inst' && claveGrupo(m.nombre) === clave).map(m => m.id)
    return modulos.filter(m => m.tipo === 'ot' && claveGrupo(m.nombre) === clave).map(m => m.id)
  }
  function anchorId(clave) {
    const ids = idsDeFamilia(clave)
    return ids.length ? Math.min(...ids) : null
  }
  function construirGrupos() {
    const map = {}
    for (const m of modulos.filter(x => x.tipo === 'ot' || x.tipo === 'inst')) {
      const clave = claveGrupo(m.nombre)
      if (!map[clave]) map[clave] = { clave, nombreBase: nombreBase(m.nombre), icono: m.icono, orden: m.orden ?? 0, tipo: m.tipo }
      else map[clave].orden = Math.min(map[clave].orden, m.orden ?? 0)
    }
    return Object.values(map).sort((a, b) => a.orden - b.orden)
  }
  const gruposVista = construirGrupos()

  function contratosDe(cid, clave) {
    const aid = anchorId(clave)
    return historial.filter(h => h.contratista_id === cid && h.modulo_id === aid)
  }

  // Estado de vigencia según fecha_inicio/fecha_fin comparadas con HOY
  function estadoContrato(c) {
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const ini = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : null
    const fin = c.fecha_fin ? new Date(c.fecha_fin + 'T00:00:00') : null
    if (ini && ini > hoy) return 'futuro'
    if (fin) {
      const diffDias = Math.ceil((fin - hoy) / 86400000)
      if (diffDias < 0) return 'vencido'
      if (diffDias <= DIAS_POR_VENCER) return 'por_vencer'
    }
    return 'vigente'
  }

  const BADGE = {
    vigente:    { label: '🟢 Vigente',    cls: 'text-green-400' },
    por_vencer: { label: '🟡 Por vencer', cls: 'text-yellow-400' },
    vencido:    { label: '🔴 Vencido',    cls: 'text-red-400' },
    futuro:     { label: '🔵 Próximo',    cls: 'text-blue-400' },
  }

  // El contrato que aplica HOY: el que cae dentro de su rango de fechas;
  // si ninguno cae dentro de rango, el más reciente como referencia.
  function contratoVigente(cid, clave) {
    const cs = contratosDe(cid, clave)
    if (cs.length === 0) return null
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const dentroDeRango = cs.filter(c => {
      const ini = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : null
      const fin = c.fecha_fin ? new Date(c.fecha_fin + 'T00:00:00') : null
      return (!ini || ini <= hoy) && (!fin || fin >= hoy)
    })
    const pool = dentroDeRango.length ? dentroDeRango : cs
    return pool.sort((a, b) => (b.fecha_inicio || '').localeCompare(a.fecha_inicio || ''))[0]
  }

  // Contratistas asignados a una familia, sin duplicar por período
  function contratistasDeFamilia(clave) {
    const ids = idsDeFamilia(clave)
    const rels = relaciones.filter(r => ids.includes(r.modulo_id)).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
    const vistos = new Set()
    const resultado = []
    for (const r of rels) {
      if (vistos.has(r.contratista_id)) continue
      vistos.add(r.contratista_id)
      const c = contratistas.find(x => x.id === r.contratista_id)
      if (c) resultado.push({ ...c, _vigente: contratoVigente(c.id, clave) })
    }
    return resultado
  }

  function clavesDeContratista(cid) {
    const mids = relaciones.filter(r => r.contratista_id === cid).map(r => r.modulo_id)
    const claves = new Set()
    for (const mid of mids) {
      const m = modulos.find(x => x.id === mid)
      if (m) claves.add(claveGrupo(m.nombre))
    }
    return [...claves]
  }

  function parseNombre(nombre) {
    const itemMatch = nombre.match(/[–-]\s*[ÍI]tem\s*(\d+)/i)
    const item = itemMatch ? `Ítem ${itemMatch[1]}` : null
    const base = nombre.replace(/\s*[–-]\s*[ÍI]tem\s*\d+/i, '').trim()
    return { base, item }
  }

  function abrir(c = null) {
    setEditando(c)
    setHistorialAbierto({})
    if (c) {
      setForm({ nombre: c.nombre, zona: c.zona||'', color: c.color||'#3b82f6' })
      setModulosSelec(clavesDeContratista(c.id).map(clave => {
        const existentes = contratosDe(c.id, clave).map(h => ({
          id: h.id,
          numero_contrato: h.numero_contrato || '',
          tasa_penalidad: h.tasa_penalidad ?? '',
          fecha_inicio: h.fecha_inicio || '',
          fecha_fin: h.fecha_fin || '',
        }))
        return { clave, contratos: existentes.length ? existentes : [{ numero_contrato:'', tasa_penalidad:'', fecha_inicio:'', fecha_fin:'' }] }
      }))
    } else {
      setForm({ nombre:'', zona:'', color: COLORES_DEFAULT[contratistas.length % COLORES_DEFAULT.length] })
      setModulosSelec([])
    }
    setModalOpen(true)
  }

  function agregarModulo(clave) {
    if (!clave || modulosSelec.some(x => x.clave === clave)) return
    setModulosSelec(prev => [...prev, { clave, contratos: [{ numero_contrato:'', tasa_penalidad:'', fecha_inicio:'', fecha_fin:'' }] }])
  }

  function quitarModulo(clave) {
    setModulosSelec(prev => prev.filter(x => x.clave !== clave))
  }

  function actualizarContrato(clave, idx, campo, valor) {
    setModulosSelec(prev => prev.map(x => {
      if (x.clave !== clave) return x
      const contratos = x.contratos.map((c, i) => i === idx ? { ...c, [campo]: valor } : c)
      return { ...x, contratos }
    }))
  }

  function agregarContrato(clave) {
    setModulosSelec(prev => prev.map(x =>
      x.clave === clave
        ? { ...x, contratos: [...x.contratos, { numero_contrato:'', tasa_penalidad:'', fecha_inicio:'', fecha_fin:'' }] }
        : x
    ))
  }

  function quitarContrato(clave, idx) {
    setModulosSelec(prev => prev.map(x =>
      x.clave === clave
        ? { ...x, contratos: x.contratos.filter((_, i) => i !== idx) }
        : x
    ))
  }

  async function guardar() {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      zona: form.zona.trim() || null,
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
      // Relaciones: por cada familia seleccionada, crear la relación con
      // TODOS los módulos-período de esa familia que existan hoy (así no
      // hay que re-copiar manualmente entre semestres).
      await supabase.from('contratista_modulos').delete().eq('contratista_id', cid)
      const filasRelacion = modulosSelec.flatMap(m =>
        idsDeFamilia(m.clave).map(mid => ({ contratista_id: cid, modulo_id: mid }))
      )
      if (filasRelacion.length > 0) {
        await supabase.from('contratista_modulos').insert(filasRelacion)
      }
      // Contratos: uno por familia (modulo_id = id ancla), con sus fechas propias
      await supabase.from('contratos_historial').delete().eq('contratista_id', cid)
      const filasContrato = modulosSelec.flatMap(m =>
        m.contratos
          .filter(c => c.numero_contrato.trim() || c.tasa_penalidad || c.fecha_inicio || c.fecha_fin)
          .map(c => ({
            contratista_id: cid,
            modulo_id: anchorId(m.clave),
            numero_contrato: c.numero_contrato.trim() || null,
            tasa_penalidad: parseFloat(c.tasa_penalidad) || 0,
            fecha_inicio: c.fecha_inicio || null,
            fecha_fin: c.fecha_fin || null,
          }))
      )
      if (filasContrato.length > 0) {
        await supabase.from('contratos_historial').insert(filasContrato)
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

      {/* ── VISTA POR MÓDULO: una tarjeta por familia, sin repetir por período ── */}
      {vista === 'modulos' && (
        <div className="space-y-5">
          {gruposVista.map(g => {
            const cs = contratistasDeFamilia(g.clave)
            return (
              <div key={g.clave} className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between"
                  style={{ background: '#111827' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{g.icono}</span>
                    <span className="text-sm font-bold text-white">{g.nombreBase}</span>
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
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Vigencia</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Zona</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Penalidad</th>
                        <th className="px-4 py-2 text-gray-500 font-semibold uppercase text-xs tracking-wide" style={{ width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cs.map((c, i) => {
                        const { base, item } = parseNombre(c.nombre)
                        const v = c._vigente
                        const estado = v ? BADGE[estadoContrato(v)] : null
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
                            <td className="px-4 py-3 text-gray-400 font-mono text-xs">{v?.numero_contrato || '—'}</td>
                            <td className="px-4 py-3 text-xs">
                              {v ? (
                                <div className={estado.cls}>
                                  {estado.label}
                                  {(v.fecha_inicio || v.fecha_fin) && (
                                    <div className="text-gray-500 mt-0.5">
                                      {v.fecha_inicio || '…'} → {v.fecha_fin || 'indefinido'}
                                    </div>
                                  )}
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-400">{c.zona || '—'}</td>
                            <td className="px-4 py-3 text-gray-400 font-mono">
                              {v?.tasa_penalidad ? `S/ ${v.tasa_penalidad}/día` : '—'}
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
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Zona</th>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold uppercase text-xs tracking-wide">Módulos / Contratos</th>
                <th className="px-4 py-3" style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {contratistas.map(c => {
                const claves = clavesDeContratista(c.id)
                const { base, item } = parseNombre(c.nombre)
                return (
                  <tr key={c.id} className="border-t border-gray-800 hover:bg-gray-900 transition-colors align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1" style={{ background: c.color || '#6b7280' }}/>
                        <div>
                          <div className="text-gray-100 font-medium">{base}</div>
                          {item && <div className="text-gray-500 text-xs">{item}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{c.zona || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {claves.length === 0
                          ? <span className="text-gray-600 text-xs italic">Sin módulos</span>
                          : claves.map(clave => {
                              const g = gruposVista.find(x => x.clave === clave)
                              const v = contratoVigente(c.id, clave)
                              const estado = v ? BADGE[estadoContrato(v)] : null
                              return (
                                <div key={clave} className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                                  <span className="px-2 py-0.5 rounded-full border border-gray-700">{g?.icono} {g?.nombreBase || clave}</span>
                                  <span className="font-mono text-gray-500">{v?.numero_contrato || '—'}</span>
                                  {v?.tasa_penalidad ? <span className="font-mono text-gray-500">S/ {v.tasa_penalidad}/día</span> : null}
                                  {estado && <span className={estado.cls}>{estado.label}</span>}
                                </div>
                              )
                            })
                        }
                      </div>
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
          <div className="modal-box" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-bold text-white">
                  {editando ? '✏️ Editar Contratista' : '+ Nuevo Contratista'}
                </h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre de la empresa *</label>
                <input className="input-base" placeholder="Ej: CONSORCIO ENERGAL – Ítem 1"
                  value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Zona / Provincia</label>
                  <input className="input-base" placeholder="Ej: Puno, Azángaro..."
                    value={form.zona} onChange={e => setForm(p => ({ ...p, zona: e.target.value }))} />
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
                <label className="text-xs font-semibold text-gray-400 block mb-1">Módulos asignados</label>
                <p className="text-[10px] text-gray-600 mb-2">Se asigna una sola vez por módulo — aplica a todos los semestres automáticamente. La vigencia del contrato depende de sus fechas, no del período.</p>

                {modulosSelec.length === 0 && (
                  <p className="text-xs text-gray-600 italic mb-2">Aún no tiene módulos asignados. Agrega uno abajo.</p>
                )}

                <div className="space-y-2">
                  {modulosSelec.map(sel => {
                    const g = gruposVista.find(x => x.clave === sel.clave)
                    const abierto = !!historialAbierto[sel.clave]
                    const contratosVisibles = abierto ? sel.contratos : sel.contratos.slice(0, 1)

                    return (
                      <div key={sel.clave} className="rounded-lg border border-gray-800 p-2.5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium">{g?.icono} {g?.nombreBase || sel.clave}</span>
                          <button className="text-gray-600 hover:text-red-400 text-xs" onClick={() => quitarModulo(sel.clave)}>
                            ✕ quitar
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {contratosVisibles.map((c) => {
                            const idx = sel.contratos.indexOf(c)
                            const estado = (c.fecha_inicio || c.fecha_fin) ? BADGE[estadoContrato(c)] : null
                            return (
                              <div key={idx} className="rounded-md border border-gray-800 p-2 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                                    {idx === 0 ? 'Contrato' : `Contrato #${idx + 1}`} {estado && <span className={estado.cls}>· {estado.label}</span>}
                                  </span>
                                  {sel.contratos.length > 1 && (
                                    <button className="text-gray-600 hover:text-red-400 text-xs" onClick={() => quitarContrato(sel.clave, idx)}>✕</button>
                                  )}
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                  <input
                                    className="input-base text-xs py-1.5 col-span-2"
                                    placeholder="N.° de contrato"
                                    value={c.numero_contrato}
                                    onChange={e => actualizarContrato(sel.clave, idx, 'numero_contrato', e.target.value)}
                                  />
                                  <input
                                    className="input-base text-xs py-1.5 col-span-2"
                                    type="number" min="0" step="0.01"
                                    placeholder="Penalidad S//día"
                                    value={c.tasa_penalidad}
                                    onChange={e => actualizarContrato(sel.clave, idx, 'tasa_penalidad', e.target.value)}
                                  />
                                  <div className="col-span-2">
                                    <label className="text-[10px] text-gray-500 block mb-0.5">Fecha inicio</label>
                                    <input
                                      className="input-base text-xs py-1.5"
                                      type="date"
                                      value={c.fecha_inicio}
                                      onChange={e => actualizarContrato(sel.clave, idx, 'fecha_inicio', e.target.value)}
                                    />
                                  </div>
                                  <div className="col-span-2">
                                    <label className="text-[10px] text-gray-500 block mb-0.5">Fecha fin</label>
                                    <input
                                      className="input-base text-xs py-1.5"
                                      type="date"
                                      value={c.fecha_fin}
                                      onChange={e => actualizarContrato(sel.clave, idx, 'fecha_fin', e.target.value)}
                                    />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="flex items-center gap-3 mt-1.5">
                          {sel.contratos.length > 1 && (
                            <button
                              className="text-[10px] text-gray-500 hover:text-gray-300"
                              onClick={() => setHistorialAbierto(p => ({ ...p, [sel.clave]: !p[sel.clave] }))}
                            >
                              {abierto ? '▲ Ocultar historial' : `▾ Ver ${sel.contratos.length - 1} contrato(s) anterior(es)`}
                            </button>
                          )}
                          <button className="text-[10px] text-blue-400 hover:text-blue-300" onClick={() => agregarContrato(sel.clave)}>
                            + Renovación / nuevo contrato
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Selector para agregar un módulo nuevo — lista plana, sin períodos */}
                <select
                  className="input-base text-xs mt-2"
                  value=""
                  onChange={e => { if (e.target.value) agregarModulo(e.target.value); e.target.value = '' }}
                >
                  <option value="">+ Asignar a un módulo...</option>
                  {gruposVista.filter(g => !modulosSelec.some(s => s.clave === g.clave)).map(g => (
                    <option key={g.clave} value={g.clave}>{g.icono} {g.nombreBase}</option>
                  ))}
                </select>
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
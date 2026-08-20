'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fmtFecha, calcularCamposConEficiencia } from '@/lib/formulas'
import ModalInstOT from './ModalInstOT'

const ESTADO_COLORS = {
  1: { label: '✓ Cumplió a tiempo', bg: '#052e16', text: '#22c55e', border: '#166534' },
  2: { label: '⚠ Cumplió tarde',    bg: '#2c1008', text: '#f97316', border: '#9a3412' },
  3: { label: '● En proceso',       bg: '#0c1d3a', text: '#60a5fa', border: '#1e3a5f' },
  4: { label: '⚡ Por vencer',      bg: '#2a1a02', text: '#f59e0b', border: '#92400e' },
  5: { label: '✗ Fuera de plazo',   bg: '#2c0808', text: '#ef4444', border: '#991b1b' },
}

const ACT_LABELS = {
  factibilidades: { label: 'Factibilidades',  color: '#06b6d4', bg: '#083344', border: '#0e7490' },
  instalaciones:  { label: 'Inst. Nuevas',    color: '#c084fc', bg: '#1a0f33', border: '#7c3aed' },
}

function BadgeActividad({ tipo }) {
  const c = ACT_LABELS[tipo] || ACT_LABELS.factibilidades
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:99, fontSize:11, fontWeight:600, border:`1px solid ${c.border}`, background:c.bg, color:c.color }}>
      {c.label}
    </span>
  )
}

function BadgeEstado({ estado }) {
  const e = ESTADO_COLORS[estado] || { label:'—', bg:'transparent', text:'#6b7280', border:'#374151' }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:99, fontSize:11, fontWeight:600, background:e.bg, color:e.text, border:`1px solid ${e.border}` }}>
      {e.label}
    </span>
  )
}

function agruparOTs(ots) {
  const grupos = {}
  const orden = []
  for (const ot of ots) {
    const key = String(ot.numero_ot || ot.id)
    if (!grupos[key]) { grupos[key] = []; orden.push(key) }
    grupos[key].push(ot)
  }
  return orden.map(k => grupos[k])
}

function anioDeOT(ot) {
  const f = ot.datos_extra?.doc_fecha_entrega || ot.fecha_inicio || ''
  return f ? f.slice(0, 4) : null
}

export default function ModuloInstPage() {
  const { id } = useParams()
  const [modulo, setModulo]           = useState(null)
  const [ots, setOts]                 = useState([])
  const [contratistas, setContratistas] = useState([])
  const [loading, setLoading]         = useState(true)
  const [modalOpen, setModalOpen]     = useState(false)
  const [otEditando, setOtEditando]   = useState(null)
  const [busqueda, setBusqueda]       = useState('')
  const [filtEstado, setFiltEstado]   = useState('')
  const [filtActividad, setFiltActividad] = useState('')
  const [anioSelec, setAnioSelec]     = useState(String(new Date().getFullYear()))

  const cargar = useCallback(async () => {
    const hoy = new Date(); hoy.setHours(0,0,0,0)
    const [{ data: mod }, { data: otsData }, { data: todosConts }, { data: rels }, { data: historial }] = await Promise.all([
      supabase.from('modulos').select('*').eq('id', id).single(),
      supabase.from('ots').select('*').eq('modulo_id', id).order('numero_ot').order('actividad'),
      supabase.from('contratistas').select('*').eq('activo', true),
      supabase.from('contratista_modulos').select('contratista_id, modulo_id').eq('modulo_id', parseInt(id)),
      supabase.from('contratos_historial').select('contratista_id, fecha_inicio, fecha_fin').eq('modulo_id', parseInt(id)),
    ])
    setModulo(mod)

    // Contratistas vigentes: asignados al módulo con contrato activo hoy (o sin fechas = siempre vigente)
    const idsAsignados = new Set((rels || []).map(r => r.contratista_id))
    const conts = (todosConts || []).filter(c => {
      if (!idsAsignados.has(c.id)) return false
      const contratos = (historial || []).filter(h => h.contratista_id === c.id)
      if (contratos.length === 0) return true
      return contratos.some(h => {
        const ini = h.fecha_inicio ? new Date(h.fecha_inicio + 'T00:00:00') : null
        const fin = h.fecha_fin    ? new Date(h.fecha_fin    + 'T00:00:00') : null
        return (!ini || ini <= hoy) && (!fin || fin >= hoy)
      })
    })
    setContratistas(conts)

    const calc = (otsData || []).map(ot => {
      const cont = (todosConts || []).find(c => c.id === ot.contratista_id)
      return { ...ot, ...calcularCamposConEficiencia(ot, cont, mod?.periodo, parseInt(id)), _cont: cont }
    })
    setOts(calc)
    setLoading(false)
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const aniosDisponibles = [...new Set([
    String(new Date().getFullYear()),
    ...ots.map(anioDeOT).filter(Boolean)
  ])].sort((a, b) => b - a)

  const otsFiltradas = ots.filter(ot => {
    if (anioDeOT(ot) !== anioSelec) return false
    if (filtEstado && String(ot.estado) !== filtEstado) return false
    if (filtActividad && ot.actividad !== filtActividad) return false
    if (busqueda && !String(ot.numero_ot || '').toLowerCase().includes(busqueda.toLowerCase())) return false
    return true
  })

  const grupos = agruparOTs(otsFiltradas)

  const total     = otsFiltradas.length
  const cumplidos = otsFiltradas.filter(o => o.estado === 1).length
  const enProceso = otsFiltradas.filter(o => o.estado === 3).length
  const porVencer = otsFiltradas.filter(o => o.estado === 4).length
  const fuera     = otsFiltradas.filter(o => o.estado === 5).length
  const penalidad = otsFiltradas.reduce((s, o) => s + (o.val_total_penalidad || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ background: '#080f1e' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0" style={{ background: '#0f1a2e' }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{modulo?.icono || '➕'}</span>
          <div>
            <h1 className="text-sm font-bold text-white">{modulo?.nombre}</h1>
            <p className="text-xs text-gray-500">Órdenes de trabajo anuales · continuo por año</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {/* Selector de año */}
          <div className="flex items-center gap-0 border border-gray-700 rounded-lg overflow-hidden">
            {aniosDisponibles.map(a => (
              <button key={a} onClick={() => setAnioSelec(a)}
                className="px-3 py-1.5 text-xs font-semibold transition-all"
                style={anioSelec === a ? { background: '#06b6d4', color: '#000' } : { background: 'transparent', color: '#5c7a9e' }}>
                {a}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs hover:border-gray-500 hover:bg-gray-800 transition-all">
            📥 Importar
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-xs hover:border-gray-500 hover:bg-gray-800 transition-all">
            📤 Exportar
          </button>
          <button onClick={() => { setOtEditando(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: '#06b6d4', color: '#000' }}>
            + Nueva OT
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid px-6 pt-4 pb-0 gap-2 flex-shrink-0" style={{ gridTemplateColumns: 'repeat(6,1fr)' }}>
        {[
          { val: total,     lbl: 'Total OTs',   color: '#06b6d4' },
          { val: cumplidos, lbl: 'A tiempo',    color: '#22c55e' },
          { val: enProceso, lbl: 'En proceso',  color: '#60a5fa' },
          { val: porVencer, lbl: 'Por vencer',  color: '#f59e0b' },
          { val: fuera,     lbl: 'Fuera plazo', color: '#ef4444' },
          { val: `S/ ${penalidad.toFixed(2)}`, lbl: 'Penalidad', color: '#f97316' },
        ].map((k, i) => (
          <div key={i} className="rounded-xl border border-gray-800 px-3 py-2.5"
            style={{ background: '#0f1a2e', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: k.color }} />
            <div className="text-lg font-bold mt-1" style={{ color: k.color }}>{k.val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{k.lbl}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 px-6 py-3 flex-wrap flex-shrink-0">
        <input className="px-3 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs text-gray-200 outline-none focus:border-blue-600"
          placeholder="🔍 Buscar N° OT..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ width: 150 }} />
        <select className="px-3 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs text-gray-200 outline-none"
          value={filtEstado} onChange={e => setFiltEstado(e.target.value)}>
          <option value="">Estado: Todos</option>
          <option value="1">✓ A tiempo</option>
          <option value="2">⚠ Cumplió tarde</option>
          <option value="3">● En proceso</option>
          <option value="4">⚡ Por vencer</option>
          <option value="5">✗ Fuera plazo</option>
        </select>
        <select className="px-3 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs text-gray-200 outline-none"
          value={filtActividad} onChange={e => setFiltActividad(e.target.value)}>
          <option value="">Actividad: Todas</option>
          <option value="factibilidades">Factibilidades</option>
          <option value="instalaciones">Inst. Nuevas</option>
        </select>
        {(busqueda || filtEstado || filtActividad) && (
          <button className="text-xs text-red-400 border border-red-900 rounded-lg px-2 py-1.5 hover:bg-red-950"
            onClick={() => { setBusqueda(''); setFiltEstado(''); setFiltActividad('') }}>
            ✕ Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-gray-600">{grupos.length} OTs · {otsFiltradas.length} registros · Año {anioSelec}</span>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 1300 }}>
            <thead>
              <tr style={{ background: '#111827' }}>
                {[['N° OT',70],['Contratista',150],['N° Contrato',120],['Actividad',130],
                  ['F. Entrega',null],['F. Inicio',null],['F. Final',null],['F. Límite',null],['Plazo',null],
                  ['Cant. Prog.',80],['F. Reporte',null],['Cant. Ent.',80],['Estado',null],
                  ['Dur.',60],['D. Fuera',70],['Val. Pen.',80],['Val. Total',90],['Observaciones',150],['Acciones',90],
                ].map(([lbl, w]) => (
                  <th key={lbl} className="px-3 py-2.5 text-left text-gray-500 font-semibold border-b border-gray-700 whitespace-nowrap"
                    style={w ? { width: w } : {}}>
                    {lbl}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr>
                  <td colSpan={19} className="py-16 text-center text-gray-600">
                    Sin OTs para el año {anioSelec}. Crea la primera con el botón de arriba.
                  </td>
                </tr>
              ) : grupos.map((par, gi) => {
                const fact = par.find(o => o.actividad === 'factibilidades') || par[0]
                const inst = par.find(o => o.actividad === 'instalaciones')
                const cont = fact._cont
                const bg = gi % 2 === 1 ? '#0a1220' : '#080f1e'
                const borderBottom = '2px solid #1e3a5f'

                const tdSpan = (content) => (
                  <td rowSpan={inst ? 2 : 1} className="px-3 py-2 border-b"
                    style={{ borderBottom, verticalAlign: 'middle', background: bg }}>
                    {content}
                  </td>
                )
                const tdF = (f, warn) => (
                  <td className="px-3 py-2 border-b border-gray-800 font-mono"
                    style={{ fontSize: 11, color: warn ? '#ef4444' : '#5c7a9e' }}>
                    {fmtFecha ? fmtFecha(f) : (f || '—')}
                  </td>
                )

                const fila = (ot, esFirst) => ot ? (
                  <tr key={ot.id} style={{ background: bg }} className="hover:brightness-110 transition-all">
                    {esFirst && tdSpan(<span className="font-bold text-sm" style={{ color: '#06b6d4' }}>OT-{String(fact.numero_ot).padStart(2,'0')}</span>)}
                    {esFirst && tdSpan(<span className="text-xs text-gray-200">{cont?.nombre || '—'}</span>)}
                    {esFirst && tdSpan(<span className="text-xs text-gray-500">{fact.contrato || cont?.contrato || '—'}</span>)}
                    <td className="px-3 py-2 border-b border-gray-800"><BadgeActividad tipo={ot.actividad} /></td>
                    {tdF(ot.datos_extra?.doc_fecha_entrega)}
                    {tdF(ot.fecha_inicio)}
                    {tdF(ot.fecha_fin_trabajos)}
                    {tdF(ot.fecha_limite_expedientes, ot.estado === 5)}
                    <td className="px-3 py-2 border-b border-gray-800 text-center text-gray-400" style={{ fontSize: 11 }}>
                      {ot.dias_plazo ? `${ot.dias_plazo}d` : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-right font-bold text-white">{ot.cantidad_programada ?? '—'}</td>
                    {tdF(ot.fecha_reporte)}
                    <td className="px-3 py-2 border-b border-gray-800 text-right font-semibold"
                      style={{ color: ot.fecha_reporte ? '#22c55e' : '#5c7a9e' }}>
                      {ot.cantidad_entregada ?? '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800">
                      {ot.estado ? <BadgeEstado estado={ot.estado} /> : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-center text-gray-400" style={{ fontSize: 11 }}>
                      {ot.duracion_real ? `${ot.duracion_real}d` : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-center font-semibold"
                      style={{ color: (ot.dias_fuera_plazo||0)>0 ? '#ef4444' : '#5c7a9e', fontSize: 11 }}>
                      {(ot.dias_fuera_plazo||0)>0 ? `${ot.dias_fuera_plazo}d` : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-right text-gray-400" style={{ fontSize: 11 }}>
                      {ot.val_penalidades_manual ? `S/ ${ot.val_penalidades_manual}` : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-right font-semibold"
                      style={{ color: (ot.val_total_penalidad||0)>0 ? '#f97316' : '#5c7a9e', fontSize: 11 }}>
                      {(ot.val_total_penalidad||0)>0 ? `S/ ${ot.val_total_penalidad.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800 text-gray-400"
                      style={{ fontSize: 11, maxWidth: 150, whiteSpace: 'normal' }}>
                      {ot.observaciones || '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-800">
                      <div className="flex items-center gap-1 justify-center">
                        <button title="Editar" onClick={() => { setOtEditando(par); setModalOpen(true) }}
                          className="w-6 h-6 rounded border border-gray-700 bg-transparent text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-all flex items-center justify-center text-xs">✏</button>
                        <button title="Generar documento"
                          className="w-6 h-6 rounded border border-gray-700 bg-transparent text-gray-400 hover:border-cyan-500 hover:text-cyan-400 transition-all flex items-center justify-center text-xs">📄</button>
                        <button title="Eliminar"
                          className="w-6 h-6 rounded border border-gray-700 bg-transparent text-gray-400 hover:border-red-500 hover:text-red-400 transition-all flex items-center justify-center text-xs">🗑</button>
                      </div>
                    </td>
                  </tr>
                ) : null

                return [fila(fact, true), inst ? fila(inst, false) : null]
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <ModalInstOT
          modulo={modulo}
          contratistas={contratistas}
          par={otEditando}
          anioActivo={anioSelec}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); cargar() }}
        />
      )}
    </div>
  )
}
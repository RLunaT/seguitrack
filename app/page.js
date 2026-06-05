'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { calcularCamposOT, getEstadoInfo, getDiasRestantes, fmtMoneda, fmtFecha } from '@/lib/formulas'
import Link from 'next/link'

const C = { 1:'#22c55e', 2:'#f97316', 3:'#3b82f6', 4:'#eab308', 5:'#ef4444' }

function Donut({ segmentos, size = 130, grosor = 24 }) {
  const r = (size - grosor) / 2
  const circunf = 2 * Math.PI * r
  const cx = size / 2, cy = size / 2
  const total = segmentos.reduce((s, x) => s + x.n, 0)
  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor} />
      <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle" fill="#4b5563" fontSize={10}>Sin datos</text>
    </svg>
  )
  let offset = 0
  const arcos = segmentos.filter(s => s.n > 0).map(s => {
    const pct = s.n / total
    const dash = pct * circunf
    const el = { ...s, dash, gap: circunf - dash, offset: offset * circunf }
    offset += pct
    return el
  })
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor} />
      {arcos.map((a, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
          stroke={a.color} strokeWidth={grosor}
          strokeDasharray={`${a.dash} ${a.gap}`}
          strokeDashoffset={-a.offset} strokeLinecap="butt" />
      ))}
    </svg>
  )
}

function BarraH({ segmentos, total, height = 8 }) {
  if (!total) return <div style={{ height, background: '#1f2937', borderRadius: height / 2 }} />
  return (
    <div style={{ height, background: '#1f2937', borderRadius: height / 2, overflow: 'hidden', display: 'flex' }}>
      {segmentos.filter(s => s.n > 0).map((s, i) => (
        <div key={i} style={{ width: `${s.n / total * 100}%`, background: s.color }} title={`${s.label || ''}: ${s.n}`} />
      ))}
    </div>
  )
}

const WIDGETS_DEF = [
  { id: 'kpis',         label: 'Tarjetas KPI',        icon: '📊' },
  { id: 'donut',        label: 'Distribución global',  icon: '🍩' },
  { id: 'modulos',      label: 'Estado por módulo',    icon: '📁' },
  { id: 'semanas',      label: 'Registros por semana', icon: '📅' },
  { id: 'urgentes',     label: 'Alertas urgentes',     icon: '⚠️' },
  { id: 'contratistas', label: 'Por contratista',      icon: '🏢' },
]
const DEFAULT_WIDGETS = { kpis: true, donut: true, modulos: true, semanas: true, urgentes: true, contratistas: true }

export default function DashboardPage() {
  const [datos, setDatos] = useState(null)
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('2026-I')
  const [widgetMenu, setWidgetMenu] = useState(false)
  const [widgets, setWidgets] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDGETS
    try { return JSON.parse(localStorage.getItem('dash_widgets') || 'null') || DEFAULT_WIDGETS } catch { return DEFAULT_WIDGETS }
  })

  function toggleWidget(id) {
    const next = { ...widgets, [id]: !widgets[id] }
    setWidgets(next)
    localStorage.setItem('dash_widgets', JSON.stringify(next))
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: ots }, { data: modulos }, { data: conts }, { data: cfg }] = await Promise.all([
      supabase.from('ots').select('*').order('fecha_limite_expedientes'),
      supabase.from('modulos').select('*').eq('activo', true).order('orden'),
      supabase.from('contratistas').select('*').eq('activo', true),
      supabase.from('config_global').select('*'),
    ])
    const p = cfg?.find(c => c.clave === 'periodo')?.valor || '2026-I'
    setPeriodo(p)

    const otsCalc = (ots || []).map(ot => {
      const cont = (conts || []).find(c => c.id === ot.contratista_id)
      return { ...ot, ...calcularCamposOT(ot, cont, p), _cont: cont, _mod: (modulos || []).find(m => m.id === ot.modulo_id) }
    })

    const mk = fn => otsCalc.filter(fn).length
    const stats = {
      total:      otsCalc.length,
      cumplidos:  mk(o => o.estado === 1 || o.estado === 2),
      a_tiempo:   mk(o => o.estado === 1),
      tarde:      mk(o => o.estado === 2),
      en_proceso: mk(o => o.estado === 3),
      por_vencer: mk(o => o.estado === 4),
      fuera:      mk(o => o.estado === 5),
      pen_total:  otsCalc.reduce((s, o) => s + (o.val_total_penalidad || 0), 0),
    }

    const xModulo = (modulos || []).map(mod => {
      const mis = otsCalc.filter(o => o.modulo_id === mod.id)
      return {
        ...mod, total: mis.length,
        cumplidos:  mis.filter(o => o.estado === 1 || o.estado === 2).length,
        a_tiempo:   mis.filter(o => o.estado === 1).length,
        tarde:      mis.filter(o => o.estado === 2).length,
        en_proceso: mis.filter(o => o.estado === 3).length,
        por_vencer: mis.filter(o => o.estado === 4).length,
        fuera:      mis.filter(o => o.estado === 5).length,
        penalidad:  mis.reduce((s, o) => s + (o.val_total_penalidad || 0), 0),
      }
    })

    const xSemana = {}
    otsCalc.forEach(o => {
      if (!o.semana) return
      if (!xSemana[o.semana]) xSemana[o.semana] = { total: 0, a_tiempo: 0, tarde: 0, en_proceso: 0, por_vencer: 0, fuera: 0 }
      xSemana[o.semana].total++
      if (o.estado === 1) xSemana[o.semana].a_tiempo++
      if (o.estado === 2) xSemana[o.semana].tarde++
      if (o.estado === 3) xSemana[o.semana].en_proceso++
      if (o.estado === 4) xSemana[o.semana].por_vencer++
      if (o.estado === 5) xSemana[o.semana].fuera++
    })

    const xContratista = (conts || []).map(c => {
      const mis = otsCalc.filter(o => o.contratista_id === c.id)
      return {
        ...c, total: mis.length,
        cumplidos: mis.filter(o => o.estado === 1 || o.estado === 2).length,
        en_proceso: mis.filter(o => o.estado === 3 || o.estado === 4).length,
        fuera: mis.filter(o => o.estado === 5).length,
        pen: mis.reduce((s, o) => s + (o.val_total_penalidad || 0), 0),
      }
    }).filter(c => c.total > 0).sort((a, b) => b.total - a.total)

    const urgentes = otsCalc
      .filter(o => o.estado === 4 || o.estado === 5)
      .sort((a, b) => (getDiasRestantes(a.fecha_limite_expedientes) ?? 999) - (getDiasRestantes(b.fecha_limite_expedientes) ?? 999))
      .slice(0, 8)

    setDatos({ stats, xModulo, xSemana: Object.entries(xSemana).sort(([a],[b]) => a.localeCompare(b)).slice(-10), xContratista, urgentes })
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="text-xs text-gray-500">Cargando dashboard…</div>
      </div>
    </div>
  )

  const { stats, xModulo, xSemana, xContratista, urgentes } = datos
  const pctCumplimiento = stats.total > 0 ? Math.round(stats.cumplidos / stats.total * 100) : 0
  const segEstados = [
    { n: stats.a_tiempo,   color: C[1], label: 'A tiempo'   },
    { n: stats.tarde,      color: C[2], label: 'Tarde'      },
    { n: stats.en_proceso, color: C[3], label: 'En proceso' },
    { n: stats.por_vencer, color: C[4], label: 'Por vencer' },
    { n: stats.fuera,      color: C[5], label: 'Fuera'      },
  ]
  const activeCount = Object.values(widgets).filter(Boolean).length

  return (
    <div className="p-5 space-y-4" style={{ maxWidth: 1600 }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Dashboard General</h1>
          <p className="text-gray-500 text-xs mt-0.5">Periodo {periodo} · {stats.total} registros totales</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={cargar} className="btn-ghost text-xs">🔄 Actualizar</button>
          <div className="relative">
            <button
              onClick={() => setWidgetMenu(v => !v)}
              className={`btn-ghost text-xs ${widgetMenu ? 'border-blue-500 text-blue-400' : ''}`}
            >
              🧩 Widgets <span className="text-gray-600 ml-1 font-mono">({activeCount}/{WIDGETS_DEF.length})</span>
            </button>
            {widgetMenu && (
              <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border border-gray-700 shadow-2xl" style={{ background: '#111827', minWidth: 215 }}>
                <div className="px-3 py-2 border-b border-gray-800 text-xs font-bold text-gray-500 uppercase tracking-wider">Mostrar / Ocultar</div>
                {WIDGETS_DEF.map(w => (
                  <label key={w.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800 cursor-pointer transition-colors">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${widgets[w.id] ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}`}>
                      {widgets[w.id] && <span className="text-white text-xs leading-none">✓</span>}
                    </div>
                    <input type="checkbox" className="hidden" checked={!!widgets[w.id]} onChange={() => toggleWidget(w.id)} />
                    <span className="text-xs text-gray-300">{w.icon} {w.label}</span>
                  </label>
                ))}
                <div className="px-3 py-2 border-t border-gray-800">
                  <button className="text-xs text-gray-600 hover:text-gray-300 transition-colors" onClick={() => {
                    setWidgets(DEFAULT_WIDGETS)
                    localStorage.setItem('dash_widgets', JSON.stringify(DEFAULT_WIDGETS))
                  }}>↺ Restablecer todo</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      {widgets.kpis && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}>
          {[
            { label: 'Total registros', value: stats.total,      color: '#3b82f6', icon: '📋', sub: 'en todos los módulos' },
            { label: 'Cumplieron',      value: stats.cumplidos,  color: '#22c55e', icon: '✅', sub: `${stats.a_tiempo} a tiempo · ${stats.tarde} tarde`, pct: pctCumplimiento },
            { label: 'En proceso',      value: stats.en_proceso, color: '#3b82f6', icon: '●',  sub: 'dentro del plazo' },
            { label: 'Por vencer',      value: stats.por_vencer, color: '#eab308', icon: '⚡', sub: 'quedan ≤ 3 días' },
            { label: 'Fuera de plazo',  value: stats.fuera,      color: '#ef4444', icon: '❌', sub: 'sin reporte, vencidos' },
            ...(stats.pen_total > 0 ? [{ label: 'Penalidades', value: fmtMoneda(stats.pen_total), color: '#f43f5e', icon: '💰', sub: 'total acumulado', small: true }] : []),
          ].map((c, i) => (
            <div key={i} className="card" style={{ borderTop: `2px solid ${c.color}`, padding: '14px 16px' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{c.icon}</span>
                <span className="text-xs text-gray-500 font-medium leading-tight">{c.label}</span>
              </div>
              <div className={`font-bold font-mono ${c.small ? 'text-sm' : 'text-3xl'} leading-none`} style={{ color: c.color }}>
                {c.value}
              </div>
              {c.pct !== undefined && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700">tasa cumplimiento</span>
                    <span className="font-mono font-bold" style={{ color: c.color }}>{c.pct}%</span>
                  </div>
                  <div style={{ height: 3, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: 2 }} />
                  </div>
                </div>
              )}
              <div className="text-xs text-gray-700 mt-1.5 leading-tight">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Donut + Módulos */}
      {(widgets.donut || widgets.modulos) && (
        <div className="grid gap-4" style={{ gridTemplateColumns: widgets.donut && widgets.modulos ? '290px 1fr' : '1fr' }}>

          {widgets.donut && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">🍩 Distribución global</div>
              <div className="flex items-center justify-center gap-5">
                <div className="relative flex-shrink-0">
                  <Donut segmentos={segEstados} size={130} grosor={24} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-2xl font-bold font-mono text-white leading-none">{pctCumplimiento}%</div>
                    <div className="text-xs text-gray-500 mt-0.5">cumplidos</div>
                  </div>
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                  {segEstados.map(s => (
                    <div key={s.label} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                      <span className="text-xs text-gray-400 flex-1 truncate">{s.label}</span>
                      <span className="text-xs font-mono font-bold flex-shrink-0" style={{ color: s.color, minWidth: 18, textAlign: 'right' }}>{s.n}</span>
                      {stats.total > 0 && (
                        <span className="text-xs text-gray-700 flex-shrink-0" style={{ minWidth: 30, textAlign: 'right' }}>{Math.round(s.n/stats.total*100)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-700 mb-1.5">Distribución acumulada</div>
                <BarraH segmentos={segEstados} total={stats.total} height={8} />
              </div>
            </div>
          )}

          {widgets.modulos && (
            <div className="card">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📁 Estado por módulo</div>
              {xModulo.filter(m => m.total > 0).length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-xs">Sin módulos con registros</div>
              ) : (
                <div className="space-y-2">
                  {xModulo.filter(m => m.total > 0).map(mod => {
                    const pct = mod.total > 0 ? Math.round(mod.cumplidos / mod.total * 100) : 0
                    const segs = [
                      { n: mod.a_tiempo,   color: C[1] },
                      { n: mod.tarde,      color: C[2] },
                      { n: mod.en_proceso, color: C[3] },
                      { n: mod.por_vencer, color: C[4] },
                      { n: mod.fuera,      color: C[5] },
                    ]
                    return (
                      <Link key={mod.id} href={`/modulo/${mod.id}`}>
                        <div className="group p-2.5 rounded-lg border border-gray-800 hover:border-gray-600 transition-all cursor-pointer" style={{ background: '#0d1526' }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span>{mod.icono}</span>
                              <span className="text-xs font-medium text-gray-300 group-hover:text-white transition-colors truncate max-w-40">{mod.nombre}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {mod.penalidad > 0 && <span className="text-xs text-red-400 font-mono">{fmtMoneda(mod.penalidad)}</span>}
                              {mod.fuera > 0 && <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: '#1c0101', color: '#f87171' }}>{mod.fuera} fuera</span>}
                              {mod.por_vencer > 0 && <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: '#2c1f00', color: '#fbbf24' }}>⚡{mod.por_vencer}</span>}
                              <span className="text-xs font-mono font-bold text-gray-500">{mod.total}</span>
                            </div>
                          </div>
                          <BarraH segmentos={segs} total={mod.total} height={6} />
                          <div className="flex justify-between mt-1">
                            <span className="text-xs text-gray-600">{pct}% cumplidos · {mod.cumplidos}/{mod.total}</span>
                            <span className="text-xs text-gray-700 group-hover:text-blue-400 transition-colors">Ver →</span>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                  {xModulo.filter(m => m.total === 0).length > 0 && (
                    <div className="text-xs text-gray-700 pt-2 border-t border-gray-800">
                      Sin registros: {xModulo.filter(m => m.total === 0).map(m => m.nombre).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Semanas + Urgentes + Contratistas */}
      {(widgets.semanas || widgets.urgentes || widgets.contratistas) && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>

          {widgets.semanas && (
            <div className="card">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📅 Registros por semana</div>
              {xSemana.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-xs">Sin datos por semana</div>
              ) : (
                <>
                  <div className="flex gap-3 mb-3 flex-wrap">
                    {[['A tiempo',C[1]],['Tarde',C[2]],['En proceso',C[3]],['Por vencer',C[4]],['Fuera',C[5]]].map(([l,c]) => (
                      <div key={l} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: c }} />
                        <span className="text-xs text-gray-600">{l}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {xSemana.map(([sem, d]) => {
                      const maxVal = Math.max(...xSemana.map(([,v]) => v.total), 1)
                      return (
                        <div key={sem} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 flex-shrink-0 font-mono" style={{ width: 76, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sem}</span>
                          <div className="flex-1">
                            <BarraH segmentos={[
                              { n: d.a_tiempo   * (d.total/maxVal), color: C[1] },
                              { n: d.tarde      * (d.total/maxVal), color: C[2] },
                              { n: d.en_proceso * (d.total/maxVal), color: C[3] },
                              { n: d.por_vencer * (d.total/maxVal), color: C[4] },
                              { n: d.fuera      * (d.total/maxVal), color: C[5] },
                            ]} total={d.total} height={18} />
                          </div>
                          <span className="text-xs font-mono text-gray-500 flex-shrink-0" style={{ width: 22, textAlign:'right' }}>{d.total}</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {widgets.urgentes && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">⚠️ Alertas urgentes</div>
                {urgentes.length > 0 && (
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ background:'#1c0101', color:'#f87171', border:'1px solid #7f1d1d' }}>
                    {urgentes.length} registros
                  </span>
                )}
              </div>
              {urgentes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-600">
                  <div className="text-3xl mb-2">✅</div>
                  <div className="text-xs">Sin alertas urgentes</div>
                  <div className="text-xs text-gray-700 mt-1">Todo dentro de plazo</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {urgentes.map(ot => {
                    const dias = getDiasRestantes(ot.fecha_limite_expedientes)
                    const info = getEstadoInfo(ot.estado)
                    const urgColor = ot.estado === 5 ? C[5] : C[4]
                    return (
                      <Link key={ot.id} href={`/modulo/${ot.modulo_id}`}>
                        <div className="p-2.5 rounded-lg border cursor-pointer transition-all hover:border-gray-500"
                          style={{ background:'#0d1526', borderColor: ot.estado === 5 ? '#3b0a0a' : '#2c1f00' }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-gray-200 truncate">
                                {ot._mod?.icono} {ot._mod?.nombre}
                                {ot.numero_ot && <span className="text-gray-500 ml-1">· #{ot.numero_ot}</span>}
                              </div>
                              {ot._cont && <div className="text-xs text-gray-600 truncate mt-0.5">{ot._cont.nombre}</div>}
                              <div className="text-xs text-gray-700 mt-0.5">{fmtFecha(ot.fecha_limite_expedientes)}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-sm font-bold font-mono" style={{ color: urgColor }}>
                                {dias === null ? '—' : dias < 0 ? `${Math.abs(dias)}d venc.` : dias === 0 ? 'HOY' : `${dias}d`}
                              </div>
                              <span className={`badge ${info.color}`} style={{ fontSize: 9, marginTop: 2, display:'inline-flex' }}>{info.label}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {widgets.contratistas && xContratista.length > 0 && (
            <div className="card">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">🏢 Por contratista</div>
              <div className="space-y-3">
                {xContratista.slice(0, 7).map(c => {
                  const pct = c.total > 0 ? Math.round(c.cumplidos / c.total * 100) : 0
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color || '#6b7280' }} />
                          <span className="text-xs text-gray-300 truncate max-w-36">{c.nombre}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {c.pen > 0 && <span className="text-xs text-red-400 font-mono">{fmtMoneda(c.pen)}</span>}
                          {c.fuera > 0 && <span className="text-xs font-mono" style={{ color: C[5] }}>{c.fuera} fuera</span>}
                          <span className="text-xs font-mono font-bold" style={{ color: pct >= 80 ? C[1] : pct >= 50 ? C[4] : C[5] }}>{pct}%</span>
                        </div>
                      </div>
                      <BarraH segmentos={[
                        { n: c.cumplidos,   color: '#22c55e', label: 'Cumplidos' },
                        { n: c.en_proceso,  color: '#3b82f6', label: 'En proceso' },
                        { n: c.fuera,       color: C[5],      label: 'Fuera' },
                      ]} total={c.total} height={5} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {widgetMenu && <div className="fixed inset-0 z-40" onClick={() => setWidgetMenu(false)} />}
    </div>
  )
}
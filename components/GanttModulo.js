'use client'
import { useState } from 'react'
import { getEstadoInfo, fmtFecha } from '@/lib/formulas'

const COLORES = { 1:'#22c55e', 2:'#f97316', 3:'#3b82f6', 4:'#eab308', 5:'#ef4444' }
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const URGENCIA = { 4:0, 5:1, 3:2, 2:3, 1:4 }
const DIA_W = 22
const DIAS_NOMBRE = ['D','L','M','X','J','V','S']

export default function GanttModulo({ ots, contratistas, modulo }) {
  const esOT = modulo?.tipo === 'ot'
  const hoy = new Date(); hoy.setHours(0,0,0,0)

  const fechas = ots.flatMap(o => [o.fecha_inicio, o.fecha_limite_expedientes].filter(Boolean)).sort()
  const primeraFecha = fechas.length ? new Date(fechas[0]+'T00:00:00') : new Date(hoy.getFullYear(),0,1)
  const ultimaFecha  = fechas.length ? new Date(fechas[fechas.length-1]+'T00:00:00') : hoy

  const defaultStart = new Date(primeraFecha.getFullYear(), primeraFecha.getMonth(), 1)
  const [periodoIni, setPeriodoIni] = useState(defaultStart)

  const MESES_VISIBLES = 3
  const periodoFin = new Date(periodoIni)
  periodoFin.setMonth(periodoFin.getMonth() + MESES_VISIBLES)
  periodoFin.setDate(0)

  const dias = []
  const d = new Date(periodoIni)
  while (d <= periodoFin) { dias.push(new Date(d)); d.setDate(d.getDate()+1) }
  const totalDias = dias.length

  function navMes(delta) {
    const n = new Date(periodoIni); n.setMonth(n.getMonth()+delta); n.setDate(1); setPeriodoIni(n)
  }
  function irAHoy() { setPeriodoIni(new Date(hoy.getFullYear(), hoy.getMonth()-1, 1)) }
  function irAPrimera() { setPeriodoIni(new Date(primeraFecha.getFullYear(), primeraFecha.getMonth(), 1)) }
  function diaOffset(fecha) { return Math.round((fecha - periodoIni) / 86400000) * DIA_W }

  const hoyOffset  = diaOffset(hoy)
  const hoyVisible = hoyOffset >= 0 && hoyOffset <= totalDias * DIA_W

  const mesGrupos = []
  dias.forEach(d => {
    const k = `${d.getFullYear()}-${d.getMonth()}`
    const last = mesGrupos[mesGrupos.length-1]
    if (last && last.key === k) last.count++
    else mesGrupos.push({ key:k, mes:d.getMonth(), year:d.getFullYear(), count:1 })
  })

  const otsOrdenadas = [...ots].sort((a,b) => {
    const ua = URGENCIA[a.estado]??5, ub = URGENCIA[b.estado]??5
    if (ua !== ub) return ua - ub
    return (a.fecha_inicio||'').localeCompare(b.fecha_inicio||'')
  })

  const gridW = totalDias * DIA_W
  const INFO_W = 424

  // Identificador según tipo de módulo
  function idRegistro(reg) {
    if (esOT && reg.numero_ot) return `OT#${reg.numero_ot}`
    return `#${reg.numero_registro}`
  }
  function labelCol() {
    return esOT ? 'N° OT' : 'N° Reg.'
  }
  function subInfo(reg) {
    if (esOT) return reg.actividad || '—'
    return reg.motivo_ot || reg.observaciones?.slice(0,20) || '—'
  }

  if (!ots.length) return (
    <div className="flex items-center justify-center h-48 text-gray-600">
      <div className="text-center"><div className="text-3xl mb-2">📅</div><div className="text-sm">Sin registros para mostrar</div></div>
    </div>
  )

  return (
    <div className="card p-0 overflow-hidden flex flex-col" style={{maxHeight:'calc(100vh - 260px)'}}>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-shrink-0" style={{background:'#0f172a'}}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-200">📅 Cronograma</span>
          <span className="text-xs text-gray-500 ml-2">
            {MESES_LARGO[periodoIni.getMonth()]} {periodoIni.getFullYear()} — {MESES_LARGO[periodoFin.getMonth()]} {periodoFin.getFullYear()}
          </span>
        </div>
        <div className="flex gap-1.5 items-center">
          <button className="btn-ghost text-xs px-3 py-1" onClick={irAPrimera}>⏮ Inicio</button>
          <button className="btn-ghost text-xs px-3 py-1" onClick={()=>navMes(-1)}>◀ Mes ant.</button>
          <button className="btn-ghost text-xs px-3 py-1" onClick={irAHoy}
            style={hoyVisible?{color:'#60a5fa',borderColor:'#3b82f6',background:'#1e3a5f'}:{}}>
            {hoyVisible ? '● Hoy' : '📍 Ir a Hoy'}
          </button>
          <button className="btn-ghost text-xs px-3 py-1" onClick={()=>navMes(1)}>Mes sig. ▶</button>
        </div>
      </div>

      {/* Contenido */}
      <div className="overflow-auto flex-1">
        <div style={{display:'flex', minWidth: INFO_W + gridW}}>

          {/* Panel izquierdo */}
          <div style={{width:INFO_W, flexShrink:0, position:'sticky', left:0, zIndex:20, background:'#0f1526'}}>
            <div style={{position:'sticky', top:0, zIndex:25, background:'#111827'}}>
              <div className="flex border-b border-gray-700 px-2 py-1.5" style={{height:28, alignItems:'center'}}>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                  {esOT ? 'Órdenes de Trabajo' : 'Registros'}
                </span>
              </div>
              <div className="flex border-b border-gray-800 py-1" style={{height:22, alignItems:'center'}}>
                <span style={{width:16, flexShrink:0}}/>
                <span className="text-xs text-gray-500" style={{width:110, flexShrink:0, paddingLeft:6}}>{labelCol()}</span>
                {esOT && <span className="text-xs text-gray-500" style={{width:110, flexShrink:0, paddingLeft:4}}>Contratista</span>}
                {!esOT && <span className="text-xs text-gray-500" style={{width:110, flexShrink:0, paddingLeft:4}}>Detalle</span>}
                <span className="text-xs text-gray-500" style={{width:72, flexShrink:0, textAlign:'center'}}>Inicio</span>
                <span className="text-xs text-gray-500" style={{width:72, flexShrink:0, textAlign:'center'}}>Límite</span>
                <span className="text-xs text-gray-500" style={{width:44, flexShrink:0, textAlign:'center'}}>Prog.</span>
              </div>
            </div>

            {otsOrdenadas.map(reg => {
              const info = getEstadoInfo(reg.estado)
              const cont = contratistas.find(c => c.id === reg.contratista_id)
              const pct  = Math.round((reg.progreso||0)*100)
              return (
                <div key={reg.id} className="flex items-center border-b border-gray-900 hover:bg-gray-900"
                  style={{height:38, gap:0}}>
                  <div style={{width:10, flexShrink:0, marginLeft:6}} title={info.label}>
                    <div style={{width:8, height:8, borderRadius:'50%', background:COLORES[reg.estado]||'#6b7280'}}/>
                  </div>
                  <div style={{width:110, flexShrink:0, paddingLeft:6, overflow:'hidden'}}>
                    <div className="text-xs font-bold text-gray-100 truncate">{idRegistro(reg)}</div>
                    <div className="text-xs text-gray-400 truncate">{subInfo(reg)}</div>
                  </div>
                  <div style={{width:110, flexShrink:0, paddingLeft:4, overflow:'hidden'}}>
                    {esOT
                      ? <div className="text-xs text-gray-300 truncate">{cont?.nombre||'—'}</div>
                      : <div className="text-xs text-gray-300 truncate">{reg.semana||'—'}</div>
                    }
                    {esOT && <div className="text-xs text-gray-500 truncate">{reg.motivo_ot||''}</div>}
                  </div>
                  <div className="text-xs font-mono text-gray-400" style={{width:72, flexShrink:0, textAlign:'center'}}>{fmtFecha(reg.fecha_inicio)}</div>
                  <div className="text-xs font-mono font-bold" style={{width:72, flexShrink:0, textAlign:'center', color: reg.estado===5?'#ef4444': reg.estado===4?'#eab308':'#94a3b8'}}>{fmtFecha(reg.fecha_limite_expedientes)}</div>
                  <div style={{width:44, flexShrink:0, paddingRight:6}}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span style={{fontSize:10, fontWeight:'bold', color:COLORES[reg.estado]||'#6b7280'}}>{pct}%</span>
                      <div style={{width:38, height:4, background:'#1e293b', borderRadius:2, overflow:'hidden'}}>
                        <div style={{width:`${pct}%`, height:'100%', background:COLORES[reg.estado]||'#6b7280', borderRadius:2}}/>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Panel derecho (calendario) */}
          <div style={{flex:1, position:'relative'}}>
            <div style={{position:'sticky', top:0, zIndex:15, background:'#111827'}}>
              <div className="flex border-b border-gray-700" style={{height:28}}>
                {mesGrupos.map((g,i) => (
                  <div key={i} className="border-r border-gray-700 last:border-0 flex items-center justify-center"
                    style={{width: g.count * DIA_W, flexShrink:0}}>
                    <span className="text-xs font-bold text-blue-300 uppercase tracking-wide">
                      {MESES_CORTO[g.mes]} {g.year}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex border-b border-gray-800" style={{height:22}}>
                {dias.map((d,i) => {
                  const esFinde = d.getDay()===0||d.getDay()===6
                  const esHoy   = d.getTime()===hoy.getTime()
                  return (
                    <div key={i} className="border-r border-gray-800 last:border-0 flex flex-col items-center justify-center"
                      style={{width:DIA_W, flexShrink:0, background: esHoy?'#1e3a5f': esFinde?'#0f1a2e':'transparent'}}>
                      <span style={{fontSize:9, color: esHoy?'#60a5fa': esFinde?'#475569':'#4b5563', fontWeight: esHoy?'bold':'normal', lineHeight:1}}>
                        {DIAS_NOMBRE[d.getDay()]}
                      </span>
                      <span style={{fontSize:9, color: esHoy?'#93c5fd': esFinde?'#475569':'#374151', fontWeight: esHoy?'bold':'normal', lineHeight:1}}>
                        {d.getDate()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{position:'relative', width: gridW}}>
              {hoyVisible && (
                <div style={{position:'absolute', top:0, bottom:0, left: hoyOffset+DIA_W/2, width:2, background:'#3b82f6', zIndex:10, opacity:0.9, pointerEvents:'none'}}/>
              )}
              {dias.map((d,i) => {
                const esFinde = d.getDay()===0||d.getDay()===6
                return esFinde ? (
                  <div key={i} style={{position:'absolute', top:0, bottom:0, left:i*DIA_W, width:DIA_W, background:'rgba(15,23,42,0.6)', pointerEvents:'none'}}/>
                ) : null
              })}
              {mesGrupos.slice(0,-1).map((g,i) => {
                const x = mesGrupos.slice(0,i+1).reduce((s,m)=>s+m.count,0) * DIA_W
                return <div key={i} style={{position:'absolute', top:0, bottom:0, left:x, width:1, background:'#334155', pointerEvents:'none'}}/>
              })}
              {otsOrdenadas.map(reg => {
                const pct = Math.round((reg.progreso||0)*100)
                let bar = null
                if (reg.fecha_inicio && reg.fecha_limite_expedientes) {
                  const ini = new Date(reg.fecha_inicio+'T00:00:00')
                  const fin = new Date(reg.fecha_limite_expedientes+'T00:00:00')
                  const x1  = Math.max(0, diaOffset(ini))
                  const x2  = Math.min(gridW, diaOffset(fin)+DIA_W)
                  const w   = x2 - x1
                  if (w > 0) bar = { x:x1, w, color:COLORES[reg.estado]||'#6b7280', pct }
                }
                const label = idRegistro(reg)
                return (
                  <div key={reg.id} className="border-b border-gray-900 relative hover:bg-gray-900" style={{height:36}}>
                    {dias.map((_,i) => (
                      <div key={i} style={{position:'absolute', top:0, bottom:0, left:i*DIA_W, width:DIA_W, borderRight:'1px solid #1e293b'}}/>
                    ))}
                    {bar && (
                      <div style={{
                        position:'absolute', top:6, height:24, left:bar.x, width:bar.w,
                        background:bar.color, borderRadius:4, overflow:'hidden',
                        display:'flex', alignItems:'center', paddingLeft:6, zIndex:5,
                        boxShadow:`0 2px 4px ${bar.color}44`
                      }} title={`${label} · ${fmtFecha(reg.fecha_inicio)} → ${fmtFecha(reg.fecha_limite_expedientes)}`}>
                        <div style={{position:'absolute', left:0, top:0, bottom:0, width:`${bar.pct}%`, background:'rgba(255,255,255,0.2)', pointerEvents:'none'}}/>
                        {bar.w > 50 && (
                          <span style={{position:'relative', zIndex:1, fontSize:10, fontWeight:'bold', color:'#fff', whiteSpace:'nowrap', textShadow:'0 1px 2px rgba(0,0,0,0.5)'}}>
                            {label} · {bar.pct}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-t border-gray-800 text-xs flex-shrink-0" style={{background:'#0f172a'}}>
        <span className="text-gray-500">Leyenda:</span>
        {[{l:'Cumplió a tiempo',c:'#22c55e'},{l:'Cumplió tarde',c:'#f97316'},{l:'En proceso',c:'#3b82f6'},{l:'Por vencer',c:'#eab308'},{l:'Fuera de plazo',c:'#ef4444'}].map(x=>(
          <div key={x.l} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{background:x.c}}/>
            <span className="text-gray-400">{x.l}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <div style={{width:2,height:12,background:'#3b82f6',borderRadius:1}}/>
          <span className="text-gray-400">Hoy</span>
        </div>
      </div>
    </div>
  )
}
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { calcularCamposConEficiencia, getEstadoInfo, fmtFecha, generarSemanas } from '@/lib/formulas'

const COLORES = { 1:'#22c55e', 2:'#f97316', 3:'#3b82f6', 4:'#eab308', 5:'#ef4444' }
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const URGENCIA = { 4:0, 5:1, 3:2, 2:3, 1:4 }
const DIA_W = 20
const DIAS_NOMBRE = ['D','L','M','X','J','V','S']

// "2026-I" -> ene-jun, "2026-II" -> jul-dic (mismo criterio usado en el resto del sistema)
function rangoDePeriodo(per) {
  const m = String(per).match(/^(\d{4})-(I{1,2})$/)
  if (!m) return null
  const anio = parseInt(m[1])
  return m[2] === 'II'
    ? { ini: new Date(anio, 6, 1), fin: new Date(anio, 11, 31) }
    : { ini: new Date(anio, 0, 1), fin: new Date(anio, 5, 30) }
}

// Nombre "familia" del módulo, sin el sufijo de período
// (ej: "Contrastes de Medidores 2026-II" -> "Contrastes de Medidores")
function nombreBase(nombre) {
  return (nombre || '').replace(/\s*20\d{2}-(I{1,2})\s*$/i, '').trim()
}
function claveGrupo(nombre) {
  return nombreBase(nombre).toLowerCase()
}

export default function GanttGeneralPage() {
  const [ots, setOts] = useState([])
  const [modulos, setModulos] = useState([])
  const [contratistas, setContratistas] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtMod, setFiltMod] = useState('')
  const [filtCont, setFiltCont] = useState('')
  const [filtEstado, setFiltEstado] = useState('')
  const [periodoIni, setPeriodoIni] = useState(() => { const h=new Date(); return new Date(h.getFullYear(), h.getMonth()-1, 1) })

  // ── Filtros de línea de tiempo (igual criterio que el Dashboard) ──
  const [verPor, setVerPor] = useState('semestral') // semestral | anual | mensual | semanal
  const [periodoSelec, setPeriodoSelec] = useState('')
  const [anioSelec, setAnioSelec] = useState('')
  const [mesSelec, setMesSelec] = useState('')
  const [semanaSelec, setSemanaSelec] = useState('')
  const [periodoActual, setPeriodoActual] = useState('2026-I')
  const [periodosList, setPeriodosList] = useState([])
  const [autoNav, setAutoNav] = useState(true) // se apaga si el usuario navega manualmente

  const hoy = new Date(); hoy.setHours(0,0,0,0)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: o }, { data: m }, { data: c }, { data: cfg }] = await Promise.all([
      supabase.from('ots').select('*').order('fecha_inicio'),
      supabase.from('modulos').select('*').eq('activo', true).order('orden'),
      supabase.from('contratistas').select('*').eq('activo', true),
      supabase.from('config_global').select('*'),
    ])
    const p = cfg?.find(x => x.clave === 'periodo')?.valor || '2026-I'
    const listaCsv = cfg?.find(x => x.clave === 'periodos_lista')?.valor || p
    const lista = [...new Set(listaCsv.split(',').map(s => s.trim()).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
    setPeriodoActual(p)
    setPeriodosList(lista.length ? lista : [p])
    setModulos(m || [])
    setContratistas(c || [])
    const calc = (o || []).map(ot => {
      const cont = (c || []).find(x => x.id === ot.contratista_id)
      const mod  = (m || []).find(x => x.id === ot.modulo_id)
      return { ...ot, ...calcularCamposConEficiencia(ot, cont, p), _mod: mod, _cont: cont }
    })
    setOts(calc)
    setLoading(false)
  }

  // ── Cuántos meses mostrar de una vez, según la vista elegida ──
  const mesesVisibles = verPor==='anual' ? 12 : verPor==='semestral' ? 6 : verPor==='mensual' ? 3 : 2

  // ── Auto-navegar la línea de tiempo al cambiar de filtro ──
  useEffect(() => {
    if (!autoNav) return
    if (verPor === 'semestral') {
      const r = rangoDePeriodo(periodoSelec || periodoActual)
      if (r) setPeriodoIni(r.ini)
    } else if (verPor === 'anual') {
      const anio = parseInt(anioSelec || (periodoSelec||periodoActual)?.split('-')[0]) || hoy.getFullYear()
      setPeriodoIni(new Date(anio, 0, 1))
    } else if (verPor === 'mensual') {
      if (mesSelec) {
        const [y, mm] = mesSelec.split('-').map(Number)
        setPeriodoIni(new Date(y, mm - 2, 1)) // un mes antes, para dar contexto
      } else {
        const r = rangoDePeriodo(periodoSelec || periodoActual)
        if (r) setPeriodoIni(r.ini)
      }
    } else if (verPor === 'semanal') {
      const per = periodoSelec || periodoActual
      if (semanaSelec) {
        const anio = parseInt(per?.split('-')[0]) || hoy.getFullYear()
        const sem = generarSemanas(anio).find(s => s.label === semanaSelec)
        if (sem) {
          const d = new Date(sem.inicio)
          d.setMonth(d.getMonth() - 1)
          setPeriodoIni(new Date(d.getFullYear(), d.getMonth(), 1))
        }
      } else {
        const r = rangoDePeriodo(per)
        if (r) setPeriodoIni(r.ini)
      }
    }
  }, [verPor, periodoSelec, anioSelec, mesSelec, semanaSelec, periodoActual, autoNav])

  const periodoFin = new Date(periodoIni)
  periodoFin.setMonth(periodoFin.getMonth() + mesesVisibles)
  periodoFin.setDate(0)

  const dias = []
  const _d = new Date(periodoIni)
  while (_d <= periodoFin) { dias.push(new Date(_d)); _d.setDate(_d.getDate()+1) }
  const gridW = dias.length * DIA_W

  function navMes(delta) { setAutoNav(false); const n=new Date(periodoIni); n.setMonth(n.getMonth()+delta); n.setDate(1); setPeriodoIni(n) }
  function irAHoy() { setAutoNav(false); setPeriodoIni(new Date(hoy.getFullYear(), hoy.getMonth()-1, 1)) }
  function irAPrimera() {
    setAutoNav(false)
    const primeras = ots.map(o=>o.fecha_inicio).filter(Boolean).sort()
    if (primeras.length) { const d=new Date(primeras[0]+'T00:00:00'); setPeriodoIni(new Date(d.getFullYear(), d.getMonth(), 1)) }
  }

  const hoyOffset = Math.round((hoy - periodoIni) / 86400000) * DIA_W
  const hoyVisible = hoyOffset >= 0 && hoyOffset <= gridW

  const mesGrupos = []
  dias.forEach(d => {
    const k = d.getFullYear()+'-'+d.getMonth()
    const last = mesGrupos[mesGrupos.length-1]
    if (last && last.key === k) last.count++
    else mesGrupos.push({ key:k, mes:d.getMonth(), year:d.getFullYear(), count:1 })
  })

  // ── Filtro por línea de tiempo (semestre/año/mes/semana), igual criterio que el Dashboard ──
  function pasaFiltroTiempo(o) {
    if (verPor === 'anual') {
      const anio = anioSelec || (periodoSelec||periodoActual)?.split('-')[0]
      return !anio || o.periodo?.split('-')[0] === String(anio)
    }
    if (verPor === 'mensual' && mesSelec) {
      return o.fecha_inicio?.slice(0,7) === mesSelec
    }
    if (verPor === 'semanal' && semanaSelec) {
      return o.periodo === (periodoSelec||periodoActual) && o.semana === semanaSelec
    }
    // semestral, o mensual/semanal sin sub-filtro elegido: por período completo
    return o.periodo === (periodoSelec || periodoActual)
  }

  // ── Módulos relevantes al rango de tiempo activo, agrupados por familia ──
  // (evita mostrar "Avisos de Medidores" repetido por cada período, y en
  // vista Anual fusiona el semestre I y II de un mismo módulo en un grupo)
  function moduloEnRango(m) {
    if (verPor === 'anual') {
      const anio = anioSelec || (periodoSelec||periodoActual)?.split('-')[0]
      return !anio || m.periodo?.split('-')[0] === String(anio)
    }
    return m.periodo === (periodoSelec || periodoActual)
  }
  const modulosEnRango = modulos.filter(moduloEnRango)
  const familias = []
  for (const m of modulosEnRango) {
    const clave = claveGrupo(m.nombre)
    let f = familias.find(x => x.clave === clave)
    if (!f) { f = { clave, nombre: nombreBase(m.nombre), icono: m.icono, color: m.color, ids: [] }; familias.push(f) }
    f.ids.push(m.id)
  }
  const modIdToClave = {}
  modulos.forEach(m => { modIdToClave[m.id] = claveGrupo(m.nombre) })

  const otsFilt = ots.filter(o =>
    pasaFiltroTiempo(o) &&
    (!filtMod  || modIdToClave[o.modulo_id] === filtMod) &&
    (!filtCont || o.contratista_id == filtCont) &&
    (!filtEstado || String(o.estado) === filtEstado)
  )

  const mesesDisponibles = [...new Set(
    ots.filter(o => o.periodo === (periodoSelec||periodoActual)).map(o => o.fecha_inicio?.slice(0,7)).filter(Boolean)
  )].sort()
  const semanasDisponibles = [...new Set(
    ots.filter(o => o.periodo === (periodoSelec||periodoActual)).map(o => o.semana).filter(s => s && s.length < 15)
  )].sort()

  const grupos = familias.map(fam => ({
    id: fam.clave,
    nombre: fam.nombre,
    icono: fam.icono,
    color: fam.color,
    ots: otsFilt.filter(o => fam.ids.includes(o.modulo_id))
      .sort((a,b) => { const ua=URGENCIA[a.estado]??5, ub=URGENCIA[b.estado]??5; return ua!==ub?ua-ub:(a.fecha_limite_expedientes||''). localeCompare(b.fecha_limite_expedientes||'') })
  })).filter(g => g.ots.length > 0)

  function getBar(ot) {
    if (!ot.fecha_inicio || !ot.fecha_limite_expedientes) return null
    const ini = new Date(ot.fecha_inicio+'T00:00:00')
    const fin = new Date(ot.fecha_limite_expedientes+'T00:00:00')
    const x1 = Math.max(0, Math.round((ini-periodoIni)/86400000)*DIA_W)
    const x2 = Math.min(gridW, Math.round((fin-periodoIni)/86400000)*DIA_W + DIA_W)
    const w = x2 - x1
    if (w <= 0) return null
    return { x:x1, w, color:COLORES[ot.estado]||'#6b7280', pct:Math.round((ot.progreso||0)*100) }
  }

  // ── Franja visual del rango filtrado, para ubicarlo de un vistazo en la línea de tiempo ──
  function getBanda() {
    if (verPor === 'anual') {
      const anio = parseInt(anioSelec || (periodoSelec||periodoActual)?.split('-')[0]) || hoy.getFullYear()
      return { desde: new Date(anio,0,1), hasta: new Date(anio,11,31), label: `Año ${anio}` }
    }
    if (verPor === 'mensual' && mesSelec) {
      const [y, mm] = mesSelec.split('-').map(Number)
      return { desde: new Date(y,mm-1,1), hasta: new Date(y,mm,0), label: `${MESES_CORTO[mm-1]} ${y}` }
    }
    if (verPor === 'semanal' && semanaSelec) {
      const per = periodoSelec || periodoActual
      const anio = parseInt(per?.split('-')[0]) || hoy.getFullYear()
      const sem = generarSemanas(anio).find(s => s.label === semanaSelec)
      return sem ? { desde: sem.inicio, hasta: sem.fin, label: semanaSelec } : null
    }
    const per = periodoSelec || periodoActual
    const r = rangoDePeriodo(per)
    return r ? { desde: r.ini, hasta: r.fin, label: per } : null
  }
  const banda = getBanda()
  const bandaX1 = banda ? Math.max(0, Math.round((banda.desde-periodoIni)/86400000)*DIA_W) : 0
  const bandaX2 = banda ? Math.min(gridW, Math.round((banda.hasta-periodoIni)/86400000)*DIA_W + DIA_W) : 0
  const bandaVisible = banda && bandaX2 > bandaX1 && bandaX1 < gridW && bandaX2 > 0

  const INFO_W = 346

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-800 flex-shrink-0" style={{background:'#0f172a'}}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-base font-bold text-white">📅 Gantt General</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {MESES_CORTO[periodoIni.getMonth()]} {periodoIni.getFullYear()} — {MESES_CORTO[periodoFin.getMonth()]} {periodoFin.getFullYear()}
              <span className="ml-3 text-gray-600">{otsFilt.length} OTs · {grupos.length} módulos</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-1">
              <button className="btn-ghost text-xs px-2 py-1" onClick={irAPrimera} title="Ir a primera OT">⏮</button>
              <button className="btn-ghost text-xs px-2 py-1" onClick={()=>navMes(-1)}>◀</button>
              <button className="btn-ghost text-xs px-2 py-1" onClick={irAHoy} style={hoyVisible?{color:'#60a5fa',borderColor:'#3b82f6',background:'#1e3a5f'}:{}}>{hoyVisible?'● Hoy':'📍 Hoy'}</button>
              <button className="btn-ghost text-xs px-2 py-1" onClick={()=>navMes(1)}>▶</button>
            </div>
            {!autoNav && (
              <button className="text-xs px-2 py-1 rounded border border-blue-900 text-blue-400 hover:bg-blue-950 w-full" onClick={()=>setAutoNav(true)} title="Volver a centrar la línea de tiempo en el filtro">
                🎯 Centrar en filtro
              </button>
            )}
          </div>
        </div>

        {/* ── Filtros de línea de tiempo ── */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <select className="input-base text-xs" style={{width:110}} value={verPor}
            onChange={e=>{setVerPor(e.target.value);setMesSelec('');setSemanaSelec('');setAnioSelec('');setAutoNav(true)}}>
            <option value="semestral">Semestral</option>
            <option value="anual">Anual</option>
            <option value="mensual">Mensual</option>
            <option value="semanal">Semanal</option>
          </select>

          {verPor==='anual' && (
            <select className="input-base text-xs" style={{width:100}}
              value={anioSelec||(periodoSelec||periodoActual)?.split('-')[0]||''}
              onChange={e=>{setAnioSelec(e.target.value);setAutoNav(true)}}>
              {[...new Set(periodosList.map(p=>p.split('-')[0]).filter(Boolean))].sort((a,b)=>b-a).map(a=>(
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}

          {verPor!=='anual' && (
            <select className="input-base text-xs" style={{width:110}}
              value={periodoSelec||periodoActual}
              onChange={e=>{setPeriodoSelec(e.target.value);setMesSelec('');setSemanaSelec('');setAutoNav(true)}}>
              {periodosList.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          )}

          {verPor==='mensual' && (
            <select className="input-base text-xs" style={{width:130}} value={mesSelec}
              onChange={e=>{setMesSelec(e.target.value);setAutoNav(true)}}>
              <option value="">Todos los meses</option>
              {mesesDisponibles.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          )}

          {verPor==='semanal' && (
            <select className="input-base text-xs" style={{width:130}} value={semanaSelec}
              onChange={e=>{setSemanaSelec(e.target.value);setAutoNav(true)}}>
              <option value="">Todas las semanas</option>
              {semanasDisponibles.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <span className="text-gray-700">│</span>

          <select className="input-base text-xs" style={{width:150}} value={filtMod} onChange={e=>setFiltMod(e.target.value)}>
            <option value="" disabled hidden>Módulo</option>
            <option value="">Todos los módulos</option>
            {familias.map(f=><option key={f.clave} value={f.clave}>{f.icono} {f.nombre}</option>)}
          </select>
          <select className="input-base text-xs" style={{width:140}} value={filtCont} onChange={e=>setFiltCont(e.target.value)}>
            <option value="" disabled hidden>Contratista</option>
            <option value="">Todos los contratistas</option>
            {contratistas.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select className="input-base text-xs" style={{width:110}} value={filtEstado} onChange={e=>setFiltEstado(e.target.value)}>
            <option value="" disabled hidden>Estado</option>
            <option value="">Todos</option>
            <option value="1">✓ A tiempo</option>
            <option value="2">⚠ Tarde</option>
            <option value="3">● En proceso</option>
            <option value="4">⚡ Por vencer</option>
            <option value="5">✗ Fuera plazo</option>
          </select>
          {(filtMod||filtCont||filtEstado) && (
            <button className="text-xs px-2 py-1 rounded border border-red-900 text-red-400 hover:bg-red-950" onClick={()=>{setFiltMod('');setFiltCont('');setFiltEstado('')}}>✕</button>
          )}
        </div>
      </div>

      {/* Chips de módulos */}
      {grupos.length > 0 && (
        <div className="flex gap-2 px-6 py-2 border-b border-gray-800 flex-wrap flex-shrink-0" style={{background:'#0a1220'}}>
          {grupos.map(g => {
            const fuera=g.ots.filter(o=>o.estado===5).length
            const vencer=g.ots.filter(o=>o.estado===4).length
            const activo=filtMod==g.id
            return (
              <button key={g.id} onClick={()=>setFiltMod(activo?'':String(g.id))}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs transition-all"
                style={{borderColor:activo?g.color:'#1e293b',background:activo?g.color+'22':'#0f172a'}}>
                <span>{g.icono}</span>
                <span className="text-gray-300 font-medium">{g.nombre}</span>
                <span className="text-gray-500 ml-0.5">{g.ots.length}</span>
                {fuera>0&&<span className="text-red-400 font-bold ml-1">{fuera}✗</span>}
                {vencer>0&&<span className="text-yellow-400 font-bold ml-1">{vencer}⚡</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Gantt */}
      <div className="overflow-auto flex-1">
        {grupos.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center"><div className="text-4xl mb-3">📅</div><div>Sin OTs para el período seleccionado</div></div>
          </div>
        ) : (
          <div style={{display:'flex', minWidth: INFO_W + gridW}}>
            {/* Panel izquierdo */}
            <div style={{width:INFO_W,flexShrink:0,position:'sticky',left:0,zIndex:20,background:'#080f1e'}}>
              <div style={{position:'sticky',top:0,zIndex:25,background:'#111827'}}>
                <div className="flex items-center border-b border-gray-700 px-3" style={{height:28}}>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Módulo / Orden de Trabajo</span>
                </div>
                <div className="flex border-b border-gray-800 py-1" style={{height:22,alignItems:'center'}}>
                  <span style={{width:14,flexShrink:0}}/>
                  <span className="text-xs text-gray-500" style={{width:96,flexShrink:0,paddingLeft:4}}>OT</span>
                  <span className="text-xs text-gray-500" style={{width:100,flexShrink:0}}>Contratista</span>
                  <span className="text-xs text-gray-500" style={{width:66,flexShrink:0,textAlign:'center'}}>Inicio</span>
                  <span className="text-xs text-gray-500" style={{width:66,flexShrink:0,textAlign:'center'}}>Límite</span>
                </div>
                {banda && <div className="flex items-center border-b border-gray-800 px-3" style={{height:18,background:'#0a1220'}}>
                  <span className="text-xs font-bold text-blue-400">🔎 {banda.label}</span>
                </div>}
              </div>
              {grupos.map(grupo=>(
                <div key={grupo.id}>
                  <div className="flex items-center gap-2 px-3 border-b border-gray-800 py-1.5"
                    style={{background:grupo.color+'15',borderLeft:'3px solid '+grupo.color}}>
                    <span style={{fontSize:13}}>{grupo.icono}</span>
                    <span className="text-xs font-bold" style={{color:grupo.color}}>{grupo.nombre}</span>
                    <span className="text-xs text-gray-500">({grupo.ots.length})</span>
                  </div>
                  {grupo.ots.map(ot=>{
                    const info=getEstadoInfo(ot.estado)
                    return (
                      <div key={ot.id} className="flex items-center border-b border-gray-900 hover:bg-gray-900" style={{height:34}}>
                        <div style={{width:14,flexShrink:0,marginLeft:6}}>
                          <div style={{width:8,height:8,borderRadius:'50%',background:COLORES[ot.estado]||'#6b7280'}} title={info.label}/>
                        </div>
                        <div style={{width:96,flexShrink:0,paddingLeft:4,overflow:'hidden'}}>
                          <div className="text-xs font-semibold text-gray-200 truncate">
                            {ot._mod?.tipo === 'ot' ? `OT#${ot.numero_ot}` : `#${ot.numero_registro}`}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{ot.actividad||'—'}</div>
                        </div>
                        <div style={{width:100,flexShrink:0,overflow:'hidden'}}>
                          <div className="text-xs text-gray-300 truncate">{ot._cont?.nombre||'—'}</div>
                        </div>
                        <div className="text-xs font-mono text-gray-500" style={{width:66,flexShrink:0,textAlign:'center'}}>{fmtFecha(ot.fecha_inicio)}</div>
                        <div className="text-xs font-mono font-bold" style={{width:66,flexShrink:0,textAlign:'center',color:ot.estado===5?'#ef4444':ot.estado===4?'#eab308':'#64748b'}}>{fmtFecha(ot.fecha_limite_expedientes)}</div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Panel calendario */}
            <div style={{flex:1,position:'relative'}}>
              <div style={{position:'sticky',top:0,zIndex:15,background:'#111827'}}>
                <div className="flex border-b border-gray-700" style={{height:28}}>
                  {mesGrupos.map((g,i)=>(
                    <div key={i} className="border-r border-gray-700 last:border-0 flex items-center justify-center"
                      style={{width:g.count*DIA_W,flexShrink:0}}>
                      <span className="text-xs font-bold text-blue-300 uppercase">{MESES_CORTO[g.mes]} {g.year}</span>
                    </div>
                  ))}
                </div>
                <div className="flex border-b border-gray-800" style={{height:22}}>
                  {dias.map((d,i)=>{
                    const esFinde=d.getDay()===0||d.getDay()===6
                    const esHoy=d.getTime()===hoy.getTime()
                    return (
                      <div key={i} className="border-r border-gray-800 last:border-0 flex flex-col items-center justify-center"
                        style={{width:DIA_W,flexShrink:0,background:esHoy?'#1e3a5f':esFinde?'#0f1a2e':'transparent'}}>
                        <span style={{fontSize:8,color:esHoy?'#60a5fa':esFinde?'#334155':'#374151',lineHeight:1}}>{DIAS_NOMBRE[d.getDay()]}</span>
                        <span style={{fontSize:8,color:esHoy?'#93c5fd':esFinde?'#334155':'#374151',lineHeight:1,fontWeight:esHoy?'bold':'normal'}}>{d.getDate()}</span>
                      </div>
                    )
                  })}
                </div>
                {/* Franja del rango filtrado — mismo alto que su equivalente en el panel izquierdo */}
                <div style={{height:18,position:'relative',background:'#0a1220',borderBottom:'1px solid #1e293b'}}>
                  {bandaVisible && (
                    <div style={{position:'absolute',top:0,bottom:0,left:bandaX1,width:bandaX2-bandaX1,
                      background:'#3b82f62a',borderLeft:'2px solid #3b82f6',borderRight:'2px solid #3b82f6'}}/>
                  )}
                </div>
              </div>
              <div style={{position:'relative',width:gridW}}>
                {bandaVisible && <div style={{position:'absolute',top:0,bottom:0,left:bandaX1,width:bandaX2-bandaX1,background:'#3b82f611',zIndex:0,pointerEvents:'none'}}/>}
                {hoyVisible&&<div style={{position:'absolute',top:0,bottom:0,left:hoyOffset+DIA_W/2,width:2,background:'#3b82f6',zIndex:10,opacity:0.9,pointerEvents:'none'}}/>}
                {dias.map((d,i)=>d.getDay()===0||d.getDay()===6?<div key={i} style={{position:'absolute',top:0,bottom:0,left:i*DIA_W,width:DIA_W,background:'rgba(15,23,42,0.5)',pointerEvents:'none'}}/>:null)}
                {grupos.map(grupo=>(
                  <div key={grupo.id}>
                    <div style={{height:34,borderBottom:'1px solid #1e293b',background:grupo.color+'08'}}/>
                    {grupo.ots.map(ot=>{
                      const bar=getBar(ot)
                      const pct=Math.round((ot.progreso||0)*100)
                      return (
                        <div key={ot.id} className="border-b border-gray-900 relative hover:bg-gray-900" style={{height:34}}>
                          {dias.map((_,i)=><div key={i} style={{position:'absolute',top:0,bottom:0,left:i*DIA_W,width:DIA_W,borderRight:'1px solid #111827'}}/>)}
                          {bar&&(
                            <div style={{position:'absolute',top:5,height:24,left:bar.x,width:bar.w,background:bar.color,borderRadius:4,overflow:'hidden',display:'flex',alignItems:'center',paddingLeft:5,zIndex:5,boxShadow:'0 2px 6px '+bar.color+'55'}}
                              title={(ot._mod?.tipo==='ot'?'OT#'+ot.numero_ot:'#'+ot.numero_registro)+' · '+(ot._mod?.nombre||'')+' · '+fmtFecha(ot.fecha_inicio)+' → '+fmtFecha(ot.fecha_limite_expedientes)}>
                              <div style={{position:'absolute',left:0,top:0,bottom:0,width:pct+'%',background:'rgba(255,255,255,0.2)',pointerEvents:'none'}}/>
                              {bar.w>45&&<span style={{position:'relative',zIndex:1,fontSize:9,fontWeight:'bold',color:'#fff',whiteSpace:'nowrap',textShadow:'0 1px 2px rgba(0,0,0,0.5)'}}>{(ot._mod?.tipo==='ot'?'OT#'+ot.numero_ot:'#'+ot.numero_registro)+' · '+pct+'%'}</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-4 px-6 py-2 border-t border-gray-800 text-xs flex-shrink-0" style={{background:'#0f172a'}}>
        <span className="text-gray-500">Leyenda:</span>
        {[{l:'Cumplió a tiempo',c:'#22c55e'},{l:'Cumplió tarde',c:'#f97316'},{l:'En proceso',c:'#3b82f6'},{l:'Por vencer',c:'#eab308'},{l:'Fuera de plazo',c:'#ef4444'}].map(x=>(
          <div key={x.l} className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{background:x.c}}/><span className="text-gray-400">{x.l}</span></div>
        ))}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5"><div style={{width:2,height:12,background:'#3b82f6',borderRadius:1}}/><span className="text-gray-400">Hoy</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3" style={{background:'#0f1a2e',border:'1px solid #1e293b'}}/><span className="text-gray-400">Fin semana</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3" style={{background:'#3b82f62a',border:'1px solid #3b82f6'}}/><span className="text-gray-400">Rango filtrado</span></div>
        </div>
      </div>
    </div>
  )
}
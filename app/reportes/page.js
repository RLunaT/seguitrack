'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { calcularCamposConEficiencia, getEficienciaLabel } from '@/lib/formulas'

// Nombre "familia" del módulo, sin el sufijo de período
// (ej: "Contrastes de Medidores 2026-II" -> "Contrastes de Medidores")
function nombreBase(nombre) {
  return (nombre || '').replace(/\s*20\d{2}-(I{1,2})\s*$/i, '').trim()
}
function claveGrupo(nombre) {
  return nombreBase(nombre).toLowerCase()
}

const ESTADO_COLORS = {
  1:{bg:'#14532d',text:'#4ade80',label:'Cumplió a tiempo'},
  2:{bg:'#431407',text:'#fb923c',label:'Cumplió tarde'},
  3:{bg:'#1e3a5f',text:'#60a5fa',label:'En proceso'},
  4:{bg:'#422006',text:'#facc15',label:'Por vencer'},
  5:{bg:'#450a0a',text:'#f87171',label:'Fuera de plazo'},
  0:{bg:'#1f2937',text:'#9ca3af',label:'Sin estado'},
}

// Orden canónico — siempre se respeta, sin importar cuándo se seleccione
const COLUMNAS = [
  {key:'numero_ot',              label:'N° OT'},
  {key:'modulo',                 label:'Módulo'},
  {key:'contratista',            label:'Contratista'},
  {key:'actividad',              label:'Actividad'},
  {key:'motivo_ot',              label:'Motivo'},
  {key:'semana',                 label:'Semana'},
  {key:'periodo',                label:'Período'},
  {key:'contrato',               label:'N° Contrato'},
  {key:'progreso',               label:'Progreso'},
  {key:'fecha_entrega_ot',       label:'F. Entrega OT'},
  {key:'fecha_inicio',           label:'F. Inicio'},
  {key:'fecha_fin_trabajos',     label:'F. Fin Trabajos'},
  {key:'fecha_limite',           label:'F. Límite Exp.'},
  {key:'dias_plazo',             label:'Plazo (días)'},
  {key:'cantidad_programada',    label:'Cant. Prog.'},
  {key:'fecha_reporte',          label:'F. Reporte'},
  {key:'cantidad_entregada',     label:'Cant. Entregada'},
  {key:'estado',                 label:'Estado'},
  {key:'duracion_real',          label:'Duración Real'},
  {key:'dias_fuera_plazo',       label:'Días Fuera Plazo'},
  {key:'val_penalidades_manual', label:'Penalidad Manual'},
  {key:'val_total_penalidad',    label:'Penalidad Total'},
  {key:'observaciones',          label:'Observaciones'},
  {key:'eficiencia',             label:'Eficiencia'},
]

const fmtFecha  = f => f ? new Date(f+'T00:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'
const fmtNum    = n => n!=null ? Number(n).toLocaleString('es-PE') : '—'
const fmtMoneda = v => v ? `S/ ${Number(v).toLocaleString('es-PE',{minimumFractionDigits:2})}` : '—'

// ── Multi-select con checkboxes ───────────────────────────────
function MultiSelect({opciones, seleccionados, onChange}) {
  const [open,setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if(ref.current&&!ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h)
  },[])
  const todo = seleccionados.size===0
  function toggle(v){ const n=new Set(seleccionados); n.has(v)?n.delete(v):n.add(v); onChange(n) }
  return (
    <div ref={ref} className="relative">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white hover:border-gray-500 transition-colors">
        <span className={todo?'text-gray-500':'text-white'}>
          {todo ? 'Todos' : `${seleccionados.size} seleccionado${seleccionados.size>1?'s':''}`}
        </span>
        <span className="text-gray-500 ml-2">{open?'▲':'▼'}</span>
      </button>
      {open&&(
        <div className="absolute z-50 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-y-auto" style={{maxHeight:200}}>
          <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800 border-b border-gray-800">
            <input type="checkbox" className="accent-blue-500" checked={todo} onChange={()=>onChange(new Set())}/>
            <span className="text-xs text-gray-300 font-semibold">Todos</span>
          </label>
          {opciones.map(op=>(
            <label key={String(op.value)} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800">
              <input type="checkbox" className="accent-blue-500"
                checked={seleccionados.has(op.value)} onChange={()=>toggle(op.value)}/>
              <span className="text-xs text-gray-300 truncate">{op.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ReportesPage() {
  const [ots,setOts]                 = useState([])
  const [modulos,setModulos]         = useState([])
  const [contratistas,setContratistas] = useState([])
  const [loading,setLoading]         = useState(true)

  // Filtros — Set vacío = sin filtro (todos)
  const [filtPeriodos,    setFiltPeriodos]    = useState(new Set())
  const [filtModulos,     setFiltModulos]     = useState(new Set())
  const [filtContratistas,setFiltContratistas]= useState(new Set())
  const [filtEstados,     setFiltEstados]     = useState(new Set())
  const [filtSemanas,     setFiltSemanas]     = useState(new Set())
  const [filtActividades, setFiltActividades] = useState(new Set())
  const [filtFechaDesde,  setFiltFechaDesde]  = useState('')
  const [filtFechaHasta,  setFiltFechaHasta]  = useState('')
  const [generandoExcel,  setGenerandoExcel]  = useState(false)

  // Presentación
  const [columnas,    setColumnas]    = useState(new Set(COLUMNAS.map(c=>c.key))) // todas por defecto
  const [ordenarPor,  setOrdenarPor]  = useState('numero_ot')
  const [ordenDir,    setOrdenarDir]  = useState('asc')
  const [agruparPor,  setAgruparPor]  = useState('')
  const [titulo,      setTitulo]      = useState('')
  const [generando,   setGenerando]   = useState(false)

  const [periodosList, setPeriodosList] = useState([])

  useEffect(()=>{cargar()},[])
  async function cargar(){
    setLoading(true)
    const [{data:o},{data:m},{data:c},{data:cfg}] = await Promise.all([
      supabase.from('ots').select('*').order('numero_ot'),
      supabase.from('modulos').select('id,nombre,icono,color,periodo').eq('activo',true).order('orden'),
      supabase.from('contratistas').select('id,nombre,contrato,tasa_penalidad').eq('activo',true),
      supabase.from('config_global').select('*'),
    ])
    const per = cfg?.find(x=>x.clave==='periodo')?.valor || '2026-I'
    const listaCsv = cfg?.find(x=>x.clave==='periodos_lista')?.valor || per
    const lista = [...new Set(listaCsv.split(',').map(s=>s.trim()).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
    setPeriodosList(lista.length?lista:[per])
    setOts(o||[]); setModulos(m||[]); setContratistas(c||[])
    setLoading(false)
  }

  // ── Módulos agrupados por familia (evita duplicados por período) ──
  const familias = useMemo(()=>{
    const f=[]
    modulos.forEach(m=>{
      const clave=claveGrupo(m.nombre)
      let x=f.find(y=>y.clave===clave)
      if(!x){x={clave,nombre:nombreBase(m.nombre),icono:m.icono,ids:[]};f.push(x)}
      x.ids.push(m.id)
    })
    return f
  },[modulos])
  const modIdToClave = useMemo(()=>{
    const map={}; modulos.forEach(m=>{map[m.id]=claveGrupo(m.nombre)}); return map
  },[modulos])

  const otsE = useMemo(()=>ots.map(ot=>{
    const contratista   = contratistas.find(c=>c.id===ot.contratista_id)
    const calculados    = calcularCamposConEficiencia(ot, contratista)   // recalcula estado, dias_fuera, penalidad, eficiencia
    const mod = modulos.find(m=>m.id===ot.modulo_id)
    return {
      ...ot,
      ...calculados,                                           // sobreescribe los valores del DB con los recalculados
      modulo_nombre:      mod ? nombreBase(mod.nombre) : '—',
      modulo_icono:       mod?.icono||'📋',
      modulo_clave:       mod ? claveGrupo(mod.nombre) : '',
      contratista_nombre: contratista?.nombre||'—',
      _tasa_penalidad:    contratista?.tasa_penalidad || 0,
    }
  }),[ots,modulos,contratistas])

  const semanas     = useMemo(()=>[...new Set(ots.map(o=>o.semana).filter(Boolean))].sort(),[ots])
  const actividades = useMemo(()=>[...new Set(ots.map(o=>o.actividad).filter(Boolean))].sort(),[ots])

  const otsFiltradas = useMemo(()=>{
    let r=[...otsE]
    if(filtPeriodos.size)      r=r.filter(o=>filtPeriodos.has(o.periodo))
    if(filtModulos.size)      r=r.filter(o=>filtModulos.has(o.modulo_clave))
    if(filtContratistas.size) r=r.filter(o=>filtContratistas.has(o.contratista_id))
    if(filtEstados.size)      r=r.filter(o=>filtEstados.has(o.estado))
    if(filtSemanas.size)      r=r.filter(o=>filtSemanas.has(o.semana))
    if(filtActividades.size)  r=r.filter(o=>filtActividades.has(o.actividad))
    if(filtFechaDesde)        r=r.filter(o=>o.fecha_inicio&&o.fecha_inicio>=filtFechaDesde)
    if(filtFechaHasta)        r=r.filter(o=>o.fecha_inicio&&o.fecha_inicio<=filtFechaHasta)
    r.sort((a,b)=>{
      const va=a[ordenarPor]??'',vb=b[ordenarPor]??''
      const c=typeof va==='number'?va-vb:String(va).localeCompare(String(vb),'es')
      return ordenDir==='asc'?c:-c
    })
    return r
  },[otsE,filtPeriodos,filtModulos,filtContratistas,filtEstados,filtSemanas,filtActividades,filtFechaDesde,filtFechaHasta,ordenarPor,ordenDir])

  // Totales calculados SIEMPRE sobre las OTs filtradas actualmente.
  // "fuera de plazo" = cualquier OT con dias_fuera_plazo > 0
  // (engloba "Cumplió tarde" y "Fuera de plazo", que son los que generan penalidad)
  const totalesReporte = useMemo(()=>({
    fueraPlazo: otsFiltradas.filter(o=>(o.dias_fuera_plazo||0)>0).length,
    penalidad:  otsFiltradas.reduce((s,o)=>s+(o.val_total_penalidad||0),0),
  }),[otsFiltradas])

  // KPIs en pantalla — misma lógica que totalesReporte para que coincidan siempre
  const kpis = useMemo(()=>{
    const total     = otsFiltradas.length
    const cumplidas = otsFiltradas.filter(o=>o.estado===1).length
    const fueraPlazo= otsFiltradas.filter(o=>(o.dias_fuera_plazo||0)>0).length
    const penalidad = otsFiltradas.reduce((s,o)=>s+(o.val_total_penalidad||0),0)
    const pct       = total>0 ? Math.round(cumplidas/total*100) : 0
    return {total,cumplidas,fueraPlazo,penalidad,pct}
  },[otsFiltradas])

  // Columnas visibles SIEMPRE en orden canónico
  const colsVisibles = useMemo(()=>COLUMNAS.filter(c=>columnas.has(c.key)),[columnas])

  function toggleCol(key){ setColumnas(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);return n}) }
  function toggleOrden(key){ if(ordenarPor===key) setOrdenarDir(d=>d==='asc'?'desc':'asc'); else{setOrdenarPor(key);setOrdenarDir('asc')} }
  function limpiar(){ setFiltPeriodos(new Set());setFiltModulos(new Set());setFiltContratistas(new Set());setFiltEstados(new Set());setFiltSemanas(new Set());setFiltActividades(new Set());setFiltFechaDesde('');setFiltFechaHasta('') }

  function getCellValue(ot,key){
    switch(key){
      case 'modulo':                 return `${ot.modulo_icono} ${ot.modulo_nombre}`
      case 'contratista':            return ot.contratista_nombre
      case 'contrato':               return ot.contrato||'—'
      case 'nombre_ot':              return ot.nombre_ot||'—'
      case 'motivo_ot':              return ot.motivo_ot||'—'
      case 'periodo':                return ot.periodo||'—'
      case 'fecha_inicio':           return fmtFecha(ot.fecha_inicio)
      case 'fecha_fin_trabajos':     return fmtFecha(ot.fecha_fin_trabajos)
      case 'fecha_limite':           return fmtFecha(ot.fecha_limite_expedientes)
      case 'fecha_reporte':          return ot.fecha_reporte ? fmtFecha(ot.fecha_reporte) : '—'
      case 'cantidad_programada':    return fmtNum(ot.cantidad_programada)
      case 'cantidad_entregada':     return ot.cantidad_entregada!=null ? fmtNum(ot.cantidad_entregada) : '—'
      case 'val_penalidades_manual': return (ot.val_penalidades_manual||0)>0 ? fmtMoneda(ot.val_penalidades_manual) : '—'
      case 'val_total_penalidad':    return fmtMoneda(ot.val_total_penalidad)
      case 'dias_fuera_plazo':       return (ot.dias_fuera_plazo||0)>0?`${ot.dias_fuera_plazo} días`:'—'
      case 'estado':                 return null
      case 'progreso':               return ot.progreso!=null?`${Math.round(ot.progreso*100)}%`:'—'
      case 'fecha_entrega_ot':       return fmtFecha(ot.fecha_entrega_ot)
      case 'eficiencia':             return ot.eficiencia!=null?`${Math.round((ot.eficiencia||0)*100)}%`:'—'
      case 'observaciones':          return ot.observaciones ? (typeof ot.observaciones==='string' ? ot.observaciones : JSON.stringify(ot.observaciones)) : '—'
      default:                       return ot[key]??'—'
    }
  }

  const otsAgrupadas = useMemo(()=>{
    if(!agruparPor) return null
    const g={}
    otsFiltradas.forEach(ot=>{
      const k=agruparPor==='modulo'?ot.modulo_nombre:agruparPor==='contratista'?ot.contratista_nombre:agruparPor==='estado'?(ESTADO_COLORS[ot.estado]?.label||'Sin estado'):agruparPor==='semana'?(ot.semana||'Sin semana'):'—'
      if(!g[k])g[k]=[]
      g[k].push(ot)
    })
    return g
  },[otsFiltradas,agruparPor])

  function filtrosActivosParaReporte(){
    const fa={}
    if(filtPeriodos.size)      fa.periodo     =[...filtPeriodos].join(', ')
    if(filtModulos.size)      fa.modulo      =[...filtModulos].map(cl=>familias.find(f=>f.clave===cl)?.nombre).filter(Boolean).join(', ')
    if(filtContratistas.size) fa.contratista =[...filtContratistas].map(id=>contratistas.find(c=>c.id===id)?.nombre).filter(Boolean).join(', ')
    if(filtEstados.size)      fa.estado      =[...filtEstados].map(e=>ESTADO_COLORS[e]?.label).filter(Boolean).join(', ')
    if(filtSemanas.size)      fa.semana      =[...filtSemanas].join(', ')
    if(filtActividades.size)  fa.actividad   =[...filtActividades].join(', ')
    if(filtFechaDesde)        fa.fechaDesde  =fmtFecha(filtFechaDesde)
    if(filtFechaHasta)        fa.fechaHasta  =fmtFecha(filtFechaHasta)
    return fa
  }

  function otsPayloadParaReporte(){
    return otsFiltradas.map(ot=>({
      numero_ot:              ot.numero_ot,
      nombre_ot:              ot.nombre_ot,
      modulo_nombre:          ot.modulo_nombre,
      modulo_icono:           ot.modulo_icono,
      contratista_nombre:     ot.contratista_nombre,
      contrato:               ot.contrato,
      actividad:              ot.actividad,
      motivo_ot:              ot.motivo_ot,
      periodo:                ot.periodo,
      semana:                 ot.semana,
      fecha_inicio:           ot.fecha_inicio,
      fecha_fin_trabajos:     ot.fecha_fin_trabajos,
      fecha_limite_expedientes: ot.fecha_limite_expedientes,
      fecha_reporte:          ot.fecha_reporte,
      cantidad_programada:    ot.cantidad_programada,
      cantidad_entregada:     ot.cantidad_entregada,
      dias_plazo:             ot.dias_plazo,
      duracion_real:          ot.duracion_real,
      dias_fuera_plazo:       ot.dias_fuera_plazo,
      val_penalidades_manual: ot.val_penalidades_manual,
      val_total_penalidad:    ot.val_total_penalidad,
      _tasa_penalidad:        ot._tasa_penalidad,
      estado:                 ot.estado,
      progreso:               ot.progreso,
      datos_extra:            ot.datos_extra || null,
      eficiencia:             ot.eficiencia,
      observaciones:          typeof ot.observaciones==='string' ? ot.observaciones : (ot.observaciones ? JSON.stringify(ot.observaciones) : null),
    }))
  }

  async function generarPDF(){
    // Guarda extra: no llamar al API si no hay datos
    if (!otsFiltradas.length) {
      alert('No hay órdenes de trabajo para generar el reporte. Verificá los filtros.')
      return
    }
    setGenerando(true)
    try {
      const fa=filtrosActivosParaReporte()

      const res = await fetch('/api/genreporte',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          titulo: titulo||'Reporte de Órdenes de Trabajo',
          subtitulo:[fa.modulo,fa.contratista].filter(Boolean).join(' · ')||null,
          filtros:fa, columnas:colsVisibles.map(c=>c.key), agruparPor, totalesReporte,
          ots:otsPayloadParaReporte().map(ot=>({...ot, fecha_limite: ot.fecha_limite_expedientes, fecha_entrega_ot: ot.datos_extra?.doc_fecha_entrega||null})),
        })
      })
      if(!res.ok) throw new Error(await res.text())
      const blob=await res.blob()
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a'); a.href=url; a.download=`Reporte_OTs_${new Date().toISOString().slice(0,10)}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(()=>URL.revokeObjectURL(url),3000)
    } catch(e){
      const msg = e.message?.startsWith('{')
        ? (JSON.parse(e.message)?.error || e.message)
        : e.message
      alert('Error al generar el reporte: ' + msg)
    }
    finally{ setGenerando(false) }
  }

  async function generarExcel(){
    if (!otsFiltradas.length) {
      alert('No hay órdenes de trabajo para generar el reporte. Verificá los filtros.')
      return
    }
    setGenerandoExcel(true)
    try {
      const fa=filtrosActivosParaReporte()
      const res = await fetch('/api/genreporte-excel',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          titulo: titulo || 'Reporte de Órdenes de Trabajo',
          subtitulo:[fa.modulo,fa.contratista].filter(Boolean).join(' · ')||null,
          filtros:fa, columnas:colsVisibles.map(c=>c.key),
          ots:otsPayloadParaReporte(),
        })
      })
      if(!res.ok) throw new Error(await res.text())
      const blob=await res.blob()
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a'); a.href=url; a.download=`Reporte_OTs_${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(()=>URL.revokeObjectURL(url),3000)
    } catch(e){
      const msg = e.message?.startsWith('{') ? (JSON.parse(e.message)?.error || e.message) : e.message
      alert('Error al generar el Excel: ' + msg)
    } finally {
      setGenerandoExcel(false)
    }
  }

  const hayFiltros=filtPeriodos.size||filtModulos.size||filtContratistas.size||filtEstados.size||filtSemanas.size||filtActividades.size||filtFechaDesde||filtFechaHasta

  if(loading) return <div className="flex items-center justify-center h-full"><div className="text-gray-500 text-sm">Cargando...</div></div>

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:'#0a0f1e'}}>
      {/* HEADER */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 flex-shrink-0" style={{background:'#0f172a'}}>
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div>
            <div className="text-white font-bold text-sm">Reportes</div>
            <div className="text-gray-500 text-xs">{otsFiltradas.length} OTs{hayFiltros?' · Filtros aplicados':''}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hayFiltros&&<button onClick={limpiar} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-all">✕ Limpiar filtros</button>}
          <button onClick={generarExcel} disabled={generandoExcel||otsFiltradas.length===0}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 border border-green-700 text-green-400 hover:bg-green-950">
            {generandoExcel?'⏳ Generando...':'📊 Descargar Excel'}
          </button>
          <button onClick={generarPDF} disabled={generando||otsFiltradas.length===0}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{background:'linear-gradient(135deg,#3b82f6,#6366f1)',color:'white'}}>
            {generando?'⏳ Generando...':'📥 Descargar PDF'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* PANEL FILTROS */}
        <div className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto p-4 flex flex-col gap-4" style={{background:'#0f172a'}}>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Título del reporte</label>
            <input className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              placeholder="Reporte de Órdenes de Trabajo" value={titulo} onChange={e=>setTitulo(e.target.value)}/>
          </div>
          <div className="border-t border-gray-800"/>
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Filtros</div>
          <div><label className="text-xs text-gray-400 mb-1 block">Período</label>
            <MultiSelect opciones={periodosList.map(p=>({value:p,label:p}))} seleccionados={filtPeriodos} onChange={setFiltPeriodos}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Módulo</label>
            <MultiSelect opciones={familias.map(f=>({value:f.clave,label:`${f.icono} ${f.nombre}`}))} seleccionados={filtModulos} onChange={setFiltModulos}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Contratista</label>
            <MultiSelect opciones={contratistas.map(c=>({value:c.id,label:c.nombre}))} seleccionados={filtContratistas} onChange={setFiltContratistas}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Estado</label>
            <MultiSelect opciones={[{value:1,label:'✓ Cumplió a tiempo'},{value:2,label:'⚠ Cumplió tarde'},{value:3,label:'● En proceso'},{value:4,label:'⚡ Por vencer'},{value:5,label:'✗ Fuera de plazo'}]} seleccionados={filtEstados} onChange={setFiltEstados}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Semana</label>
            <MultiSelect opciones={semanas.map(s=>({value:s,label:s}))} seleccionados={filtSemanas} onChange={setFiltSemanas}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Actividad</label>
            <MultiSelect opciones={actividades.map(a=>({value:a,label:a}))} seleccionados={filtActividades} onChange={setFiltActividades}/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">F. Inicio desde</label>
            <input type="date" value={filtFechaDesde} onChange={e=>setFiltFechaDesde(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"/></div>
          <div><label className="text-xs text-gray-400 mb-1 block">F. Inicio hasta</label>
            <input type="date" value={filtFechaHasta} onChange={e=>setFiltFechaHasta(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"/></div>
          <div className="border-t border-gray-800"/>
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Presentación</div>
          <div><label className="text-xs text-gray-400 mb-1 block">Agrupar por</label>
            <select value={agruparPor} onChange={e=>setAgruparPor(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
              <option value="">Sin agrupación</option><option value="modulo">Módulo</option>
              <option value="contratista">Contratista</option><option value="estado">Estado</option><option value="semana">Semana</option>
            </select></div>
          <div><label className="text-xs text-gray-400 mb-1 block">Ordenar por</label>
            <select value={ordenarPor} onChange={e=>setOrdenarPor(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500">
              <option value="numero_ot">N° OT</option><option value="fecha_inicio">Fecha inicio</option>
              <option value="val_total_penalidad">Penalidad</option><option value="dias_fuera_plazo">Días fuera</option><option value="estado">Estado</option>
            </select></div>
          <div>
            <div className="text-xs text-gray-400 mb-2">Columnas <span className="text-gray-600">({columnas.size}/{COLUMNAS.length})</span></div>
            <div className="flex flex-col gap-1.5">
              {COLUMNAS.map(col=>(
                <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" className="accent-blue-500 flex-shrink-0" checked={columnas.has(col.key)} onChange={()=>toggleCol(col.key)}/>
                  <span className="text-xs text-gray-300 group-hover:text-white transition-colors">{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* PREVIEW */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              {label:'Total OTs',      value:kpis.total,                        sub:'en la selección',     color:'#3b82f6'},
              {label:'Cumplidas',       value:kpis.cumplidas,                    sub:`${kpis.pct}% a tiempo`,color:'#22c55e'},
              {label:'Fuera de plazo', value:kpis.fueraPlazo,                    sub:'incumplidas',         color:'#ef4444'},
              {label:'Penalidad',      value:fmtMoneda(Math.round(kpis.penalidad)),sub:'selección actual',  color:'#f59e0b'},
            ].map(k=>(
              <div key={k.label} className="rounded-xl p-4 border border-gray-800" style={{background:'#0f172a'}}>
                <div className="text-xs text-gray-500 mb-1">{k.label}</div>
                <div className="text-xl font-bold" style={{color:k.color}}>{k.value}</div>
                <div className="text-xs text-gray-600 mt-1">{k.sub}</div>
              </div>
            ))}
          </div>
          {otsFiltradas.length===0?(
            <div className="flex flex-col items-center justify-center h-64 text-gray-600">
              <div className="text-4xl mb-3">🔍</div>
              <div className="text-sm">No hay OTs con los filtros seleccionados</div>
            </div>
          ):(
            <div className="rounded-xl border border-gray-800 overflow-auto" style={{maxHeight:'65vh'}}>
              <table className="text-xs" style={{borderCollapse:'collapse',width:'max-content',minWidth:'100%'}}>
                <thead>
                  <tr style={{background:'#111827'}}>
                    {colsVisibles.map(col=>(
                      <th key={col.key} onClick={()=>toggleOrden(col.key)}
                        style={{position:'sticky',top:0,zIndex:10,background:'#111827',minWidth:110}}
                        className="px-3 py-2.5 text-left text-gray-400 font-semibold border-b border-gray-700 cursor-pointer hover:text-white whitespace-nowrap select-none">
                        {col.label}{ordenarPor===col.key&&<span className="ml-1 text-blue-400">{ordenDir==='asc'?'↑':'↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(()=>{
                    const rows=[]
                    const renderRow=(ot,i)=>(
                      <tr key={ot.id} className="border-b border-gray-800 hover:bg-gray-900 transition-colors" style={{background:i%2===0?'transparent':'#0a0f1e'}}>
                        {colsVisibles.map(col=>{
                          if(col.key==='estado'){const e=ESTADO_COLORS[ot.estado]||ESTADO_COLORS[0];return(<td key={col.key} style={{minWidth:110}} className="px-3 py-2 whitespace-nowrap"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{background:e.bg,color:e.text}}>{e.label}</span></td>)}
                          return(<td key={col.key} style={{minWidth:110}} className="px-3 py-2 text-gray-300 whitespace-nowrap">{getCellValue(ot,col.key)}</td>)
                        })}
                      </tr>
                    )
                    if(otsAgrupadas){Object.entries(otsAgrupadas).forEach(([g,items])=>{rows.push(<tr key={`g-${g}`} style={{background:'#1e293b'}}><td colSpan={colsVisibles.length} className="px-3 py-2 text-xs font-bold text-blue-300 border-b border-gray-800">{g} ({items.length})</td></tr>);items.forEach((ot,i)=>rows.push(renderRow(ot,i)))})}
                    else{otsFiltradas.forEach((ot,i)=>rows.push(renderRow(ot,i)))}
                    return rows
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
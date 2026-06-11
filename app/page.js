'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  calcularCamposOT, getEstadoInfo, getDiasRestantes,
  fmtMoneda, fmtFecha, getEficienciaLabel, getEficienciaModulo
} from '@/lib/formulas'
import Link from 'next/link'

const C = { 1:'#22c55e', 2:'#f97316', 3:'#3b82f6', 4:'#eab308', 5:'#ef4444' }
const ESTADO_LABELS = { 1:'Cumplió a tiempo', 2:'Cumplió tarde', 3:'En proceso', 4:'Por vencer', 5:'Fuera de plazo' }

// ── Tooltip ────────────────────────────────────────────────────
function Tooltip({ children, content, block=false }) {
  const [show, setShow] = useState(false)
  const [pos, setPos]   = useState({ x: 0, y: 0 })
  return (
    <div style={{display: block ? 'block' : 'inline-block'}} onMouseEnter={e=>{setShow(true);setPos({x:e.clientX,y:e.clientY})}} onMouseLeave={()=>setShow(false)} onMouseMove={e=>setPos({x:e.clientX,y:e.clientY})}>
      {children}
      {show && content && (
        <div className="fixed z-50 pointer-events-none" style={{left:pos.x+14,top:pos.y-8,maxWidth:220}}>
          <div className="rounded-lg border border-gray-700 shadow-2xl text-xs p-2.5" style={{background:'#1f2937'}}>
            {content}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Donut ──────────────────────────────────────────────────────
function Donut({ segs, size=120, grosor=22, centro }) {
  const r=(size-grosor)/2, circ=2*Math.PI*r, cx=size/2, cy=size/2
  const total=segs.reduce((s,x)=>s+x.n,0)
  const [hov, setHov] = useState(null)
  if(!total) return <svg width={size} height={size}><circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor}/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="#4b5563" fontSize={10}>Sin datos</text></svg>
  let off=0
  const arcos=segs.filter(s=>s.n>0).map(s=>{const pct=s.n/total,dash=pct*circ,el={...s,dash,gap:circ-dash,offset:off*circ,pct:Math.round(pct*100)};off+=pct;return el})
  const hovInfo = hov!==null ? arcos[hov] : null
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor}/>
        {arcos.map((a,i)=>(
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={hov===i?grosor+4:grosor}
            strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={-a.offset} strokeLinecap="butt"
            style={{cursor:'pointer',transition:'stroke-width 0.15s',opacity:hov!==null&&hov!==i?0.5:1}}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}/>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {hovInfo ? (
          <>
            <div className="text-lg font-bold font-mono text-white leading-none">{hovInfo.pct}%</div>
            <div className="text-xs mt-0.5 text-center px-1 leading-tight" style={{color:hovInfo.color}}>{hovInfo.label}</div>
            <div className="text-xs text-gray-500">{hovInfo.n}</div>
          </>
        ) : centro}
      </div>
    </div>
  )
}

// ── Barra horizontal ───────────────────────────────────────────
function Bar({ segs, total, h=7, showTooltip=true }) {
  const [hov, setHov] = useState(null)
  if(!total) return <div style={{height:h,background:'#1f2937',borderRadius:h/2}}/>
  return (
    <div style={{position:'relative'}}>
      <div style={{height:h,background:'#1f2937',borderRadius:h/2,overflow:'hidden',display:'flex'}}>
        {segs.filter(s=>s.n>0).map((s,i)=>(
          <div key={i} style={{width:`${s.n/total*100}%`,background:s.color,cursor:'pointer',opacity:hov!==null&&hov!==i?0.6:1,transition:'opacity 0.15s'}}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
            title={showTooltip&&s.label?`${s.label}: ${s.n} (${Math.round(s.n/total*100)}%)`:''}/>
        ))}
      </div>
    </div>
  )
}

// ── KPI Card ───────────────────────────────────────────────────
function KpiCard({ label, value, color, sub, icon, pct, small, tooltip }) {
  return (
    <Tooltip content={tooltip}>
      <div className="card h-full" style={{borderTop:`2px solid ${color}`,padding:'12px 14px',cursor:tooltip?'help':'default'}}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-xs text-gray-500 font-medium leading-tight">{label}</span>
        </div>
        <div className={`font-bold font-mono leading-none ${small?'text-sm':'text-2xl'}`} style={{color}}>{value}</div>
        {pct!==undefined&&(
          <div className="mt-1.5">
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-gray-700">cumplimiento</span>
              <span className="font-mono font-bold" style={{color}}>{pct}%</span>
            </div>
            <div style={{height:3,background:'#1f2937',borderRadius:2,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:color,transition:'width 0.4s'}}/>
            </div>
          </div>
        )}
        <div className="text-xs text-gray-700 mt-1 leading-tight">{sub}</div>
      </div>
    </Tooltip>
  )
}

// ── Barra de eficiencia ────────────────────────────────────────
function EficBar({ valor, label, max=100 }) {
  const ei = getEficienciaLabel(valor)
  const w  = valor !== null ? Math.round((valor/max)*100) : 0
  return (
    <Tooltip content={<><div className="font-bold" style={{color:ei.color}}>{ei.label} — {valor ?? '—'}%</div><div className="text-gray-400 mt-1">{label}</div><div className="text-gray-500 mt-0.5 text-xs">Nota: {ei.grade}</div></>}>
      <div className="flex items-center gap-2 cursor-help">
        <div className="flex-1" style={{height:8,background:'#1f2937',borderRadius:4,overflow:'hidden'}}>
          <div style={{width:`${w}%`,height:'100%',background:ei.color,borderRadius:4,transition:'width 0.5s'}}/>
        </div>
        <span className="text-xs font-mono font-bold flex-shrink-0" style={{color:ei.color,width:32,textAlign:'right'}}>
          {valor!==null?`${valor}%`:'—'}
        </span>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{background:ei.color+'22',color:ei.color,minWidth:22,textAlign:'center'}}>
          {ei.grade}
        </span>
      </div>
    </Tooltip>
  )
}

// ── Leyenda ────────────────────────────────────────────────────
function Leyenda({ items }) {
  return (
    <div className="flex gap-3 flex-wrap">
      {items.map(([l,c])=>(
        <div key={l} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{background:c}}/>
          <span className="text-xs text-gray-500">{l}</span>
        </div>
      ))}
    </div>
  )
}

const LEYENDA_ESTADOS = [['A tiempo',C[1]],['Cumplió tarde',C[2]],['En proceso',C[3]],['Por vencer',C[4]],['Fuera de plazo',C[5]]]


// ── Gráfico de líneas por semana (Chart.js) ───────────────────

// ── Evolución por semana — barras apiladas (Chart.js) ─────────
function SemanaChart({ data }) {
  const wrapRef  = useRef(null)
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)
  const [ready, setReady] = useState(typeof window !== 'undefined' && !!window.Chart)

  // espera a que Chart.js esté disponible
  useEffect(() => {
    if (ready) return
    const t = setInterval(() => { if (window.Chart) { setReady(true); clearInterval(t) } }, 50)
    return () => clearInterval(t)
  }, [ready])

  useEffect(() => {
    if (!ready || !data || data.length === 0 || !canvasRef.current || !wrapRef.current) return
    const ChartJS = window.Chart

    const labels = data.map(([s]) => s.replace('Semana ', 'S'))
    const mk = (key, color, label) => ({
      label,
      data: data.map(([, d]) => d[key]),
      backgroundColor: color,
      borderWidth: 0,
      stack: 'total',
    })
    const datasets = [
      mk('a_tiempo',   '#22c55e', 'A tiempo'),
      mk('tarde',      '#f97316', 'Cumplió tarde'),
      mk('en_proceso', '#3b82f6', 'En proceso'),
      mk('por_vencer', '#eab308', 'Por vencer'),
      mk('fuera',      '#ef4444', 'Fuera de plazo'),
    ]

    // Chart.js gestiona el tamaño — nunca tocar canvas.width/height manualmente
    // El wrapper div tiene la altura fija; su ancho se expande para scroll
    const COL_W = 52
    const wrapW = wrapRef.current.parentElement?.clientWidth || 400
    const chartW = Math.max(wrapW, data.length * COL_W)
    wrapRef.current.style.width = chartW + 'px'

    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }

    chartRef.current = new ChartJS(canvasRef.current, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#1f2937',
            borderColor: '#374151',
            borderWidth: 1,
            titleColor: '#f3f4f6',
            bodyColor: '#9ca3af',
            padding: 10,
            callbacks: {
              title: items => (items[0]?.label || '').replace(/^S(\d+)$/, 'Semana $1'),
              label: ctx => ctx.parsed.y ? `  ${ctx.dataset.label}: ${ctx.parsed.y}` : null,
              footer: items => {
                const total = items.reduce((s, i) => s + i.parsed.y, 0)
                return total ? `  Total: ${total}` : ''
              }
            }
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#6b7280', font: { size: 9 }, maxRotation: 0, autoSkip: false },
            grid: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#6b7280', font: { size: 9 }, precision: 0 },
            grid: { color: '#1f2937' },
          }
        },
        layout: { padding: { top: 8 } }
      }
    })
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [data, ready])

  if (!data || data.length === 0) return (
    <div className="flex flex-col items-center justify-center py-8 text-gray-600">
      <div className="text-2xl mb-2">📅</div>
      <div className="text-xs">Sin datos por semana</div>
    </div>
  )

  return (
    <div>
      <div style={{display:'flex',flexWrap:'wrap',gap:'8px 14px',marginBottom:8}}>
        {[['A tiempo','#22c55e'],['Cumplió tarde','#f97316'],['En proceso','#3b82f6'],['Por vencer','#eab308'],['Fuera de plazo','#ef4444']].map(([l,c])=>(
          <span key={l} style={{display:'flex',alignItems:'center',gap:4,fontSize:10,color:'#9ca3af'}}>
            <span style={{width:10,height:10,background:c,display:'inline-block',borderRadius:2,flexShrink:0}}/>
            {l}
          </span>
        ))}
      </div>
      <div style={{overflowX:'auto', overflowY:'visible'}}>
        <div ref={wrapRef} style={{height:200, position:'relative'}}>
          <canvas ref={canvasRef}/>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [datos, setDatos]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [periodo, setPeriodo]     = useState('2026-I')
  const [modActivo, setModActivo] = useState('general')

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: ots }, { data: modulos }, { data: conts }, { data: cfg }] = await Promise.all([
      supabase.from('ots').select('*').order('fecha_limite_expedientes'),
      supabase.from('modulos').select('*').eq('activo', true).order('orden'),
      supabase.from('contratistas').select('*').eq('activo', true),
      supabase.from('config_global').select('*'),
    ])
    const p = cfg?.find(c=>c.clave==='periodo')?.valor || '2026-I'
    setPeriodo(p)

    const otsCalc = (ots||[]).map(ot => {
      const cont = (conts||[]).find(c=>c.id===ot.contratista_id)
      const mod  = (modulos||[]).find(m=>m.id===ot.modulo_id)
      const efic = getEficienciaModulo({...ot, cantidad_entregada: ot.cantidad_entregada}, ot.modulo_id)
      return { ...ot, ...calcularCamposOT(ot, cont, p), _cont:cont, _mod:mod, eficiencia:efic }
    })

    const mk=(arr,fn)=>arr.filter(fn).length
    function statsOf(arr) {
      const con_efic = arr.filter(o=>o.eficiencia!==null&&o.eficiencia!==undefined)
      return {
        total:       arr.length,
        cumplidos:   mk(arr,o=>o.estado===1||o.estado===2),
        a_tiempo:    mk(arr,o=>o.estado===1),
        tarde:       mk(arr,o=>o.estado===2),
        en_proceso:  mk(arr,o=>o.estado===3),
        por_vencer:  mk(arr,o=>o.estado===4),
        fuera:       mk(arr,o=>o.estado===5),
        con_reporte: mk(arr,o=>!!o.fecha_reporte),
        pen_total:   arr.reduce((s,o)=>s+(o.val_total_penalidad||0),0),
        efic_prom:   con_efic.length>0 ? Math.round(con_efic.reduce((s,o)=>s+(o.eficiencia||0),0)/con_efic.length) : null,
      }
    }

    const global = statsOf(otsCalc)

    const xModulo = (modulos||[]).map(mod => {
      const mis = otsCalc.filter(o=>o.modulo_id===mod.id)
      const s   = statsOf(mis)

      // Por contratista con eficiencia
      const xCont = (conts||[]).map(c => {
        const mc   = mis.filter(o=>o.contratista_id===c.id)
        const cefic = mc.filter(o=>o.eficiencia!==null&&o.eficiencia!==undefined)
        return {
          ...c, total:mc.length,
          cumplidos:  mk(mc,o=>o.estado===1||o.estado===2),
          a_tiempo:   mk(mc,o=>o.estado===1),
          tarde:      mk(mc,o=>o.estado===2),
          en_proceso: mk(mc,o=>o.estado===3||o.estado===4),
          fuera:      mk(mc,o=>o.estado===5),
          pen:        mc.reduce((s,o)=>s+(o.val_total_penalidad||0),0),
          efic_prom:  cefic.length>0 ? Math.round(cefic.reduce((s,o)=>s+(o.eficiencia||0),0)/cefic.length) : null,
          pct_cumpl:  mc.length>0 ? Math.round(mk(mc,o=>o.estado===1||o.estado===2)/mc.length*100) : 0,
          cantidad_prog: mc.reduce((s,o)=>s+(o.cantidad_programada||0),0),
          cantidad_entr: mc.reduce((s,o)=>s+(o.cantidad_entregada||0),0),
        }
      }).filter(c=>c.total>0).sort((a,b)=>(b.efic_prom??-1)-(a.efic_prom??-1))

      // Por semana
      const xSem = {}
      mis.forEach(o=>{
        if(!o.semana) return
        if(!xSem[o.semana]) xSem[o.semana]={total:0,a_tiempo:0,tarde:0,en_proceso:0,por_vencer:0,fuera:0}
        xSem[o.semana].total++
        if(o.estado===1) xSem[o.semana].a_tiempo++
        if(o.estado===2) xSem[o.semana].tarde++
        if(o.estado===3) xSem[o.semana].en_proceso++
        if(o.estado===4) xSem[o.semana].por_vencer++
        if(o.estado===5) xSem[o.semana].fuera++
      })

      return {
        ...mod, ...s, ots:mis, xCont,
        xSemana: Object.entries(xSem).sort(([a],[b])=>a.localeCompare(b)),
        tiene_cantidad: [1,2,3].includes(mod.id),
      }
    })

    // Urgentes
    const urgentes = otsCalc
      .filter(o=>o.estado===4||o.estado===5)
      .sort((a,b)=>(getDiasRestantes(a.fecha_limite_expedientes)??999)-(getDiasRestantes(b.fecha_limite_expedientes)??999))
      .slice(0,10)

    // Semana global
    const xSemG = {}
    otsCalc.forEach(o=>{
      if(!o.semana) return
      if(!xSemG[o.semana]) xSemG[o.semana]={total:0,a_tiempo:0,tarde:0,en_proceso:0,por_vencer:0,fuera:0}
      xSemG[o.semana].total++
      if(o.estado===1) xSemG[o.semana].a_tiempo++
      if(o.estado===2) xSemG[o.semana].tarde++
      if(o.estado===3) xSemG[o.semana].en_proceso++
      if(o.estado===4) xSemG[o.semana].por_vencer++
      if(o.estado===5) xSemG[o.semana].fuera++
    })

    setDatos({ global, xModulo, urgentes, xSemG:Object.entries(xSemG).sort(([a],[b])=>a.localeCompare(b)).slice(-12) })
    setLoading(false)
  }, [])

  useEffect(()=>{
    if (!window.Chart) {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
      s.onload = () => cargar()
      document.head.appendChild(s)
    } else {
      cargar()
    }
  },[cargar])

  if(loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>
        <div className="text-xs text-gray-500">Cargando dashboard…</div>
      </div>
    </div>
  )

  const { global, xModulo, urgentes, xSemG } = datos
  const pctG = global.total>0 ? Math.round(global.cumplidos/global.total*100) : 0
  const segG = [
    {n:global.a_tiempo,   color:C[1], label:'A tiempo'},
    {n:global.tarde,      color:C[2], label:'Cumplió tarde'},
    {n:global.en_proceso, color:C[3], label:'En proceso'},
    {n:global.por_vencer, color:C[4], label:'Por vencer'},
    {n:global.fuera,      color:C[5], label:'Fuera de plazo'},
  ]
  const modSelec = modActivo!=='general' ? xModulo.find(m=>m.id===parseInt(modActivo)) : null

  return (
    <div className="p-5 space-y-5" style={{maxWidth:1600}}>

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">📊 Dashboard General</h1>
          <p className="text-gray-500 text-xs mt-0.5">Periodo {periodo} · {global.total} registros · {xModulo.length} módulos activos</p>
        </div>
        <button onClick={cargar} className="btn-ghost text-xs">🔄 Actualizar</button>
      </div>

      {/* ── SELECTOR DE MÓDULO ── */}
      <div className="flex gap-2 flex-wrap p-1">
        {[{id:'general',icono:'🌐',nombre:'General',total:global.total,fuera:global.fuera,por_vencer:global.por_vencer},...xModulo.filter(m=>m.total>0)].map(m=>(
          <Tooltip key={m.id} content={m.id!=='general'&&<>
            <div className="font-bold text-white mb-1">{m.icono} {m.nombre}</div>
            <div className="space-y-0.5">
              <div className="flex justify-between gap-3"><span className="text-gray-400">Total:</span><span className="font-mono">{m.total}</span></div>
              <div className="flex justify-between gap-3"><span style={{color:C[1]}}>A tiempo:</span><span className="font-mono">{m.a_tiempo}</span></div>
              <div className="flex justify-between gap-3"><span style={{color:C[5]}}>Fuera:</span><span className="font-mono">{m.fuera}</span></div>
              {m.pen_total>0&&<div className="flex justify-between gap-3"><span className="text-red-400">Penalidad:</span><span className="font-mono text-red-400">{fmtMoneda(m.pen_total)}</span></div>}
            </div>
          </>}>
            <button onClick={()=>setModActivo(String(m.id))}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all ${modActivo===String(m.id)?'bg-blue-900 border-blue-600 text-blue-200':'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}>
              {m.icono} {m.nombre}
              <span className="font-mono opacity-70">{m.total}</span>
              {(m.fuera||0)>0&&<span className="text-red-400 font-mono text-xs font-bold">{m.fuera}✗</span>}
              {(m.por_vencer||0)>0&&<span className="text-yellow-400 font-mono text-xs">⚡{m.por_vencer}</span>}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* ══════════ VISTA GENERAL ══════════ */}
      {modActivo==='general' && (<>

        {/* KPIs */}
        <div className="grid gap-3" style={{gridTemplateColumns:'repeat(auto-fit,minmax(148px,1fr))'}}>
          <KpiCard label="Total registros" value={global.total} color="#3b82f6" icon="📋" sub={`en ${xModulo.filter(m=>m.total>0).length} módulos`} tooltip={<><div className="font-bold text-white mb-1">Total de registros</div><div className="text-gray-400">Suma de todos los registros en todos los módulos activos del periodo {periodo}.</div></>}/>
          <KpiCard label="Cumplieron" value={global.cumplidos} color="#22c55e" icon="✅" pct={pctG} sub={`${global.a_tiempo} a tiempo · ${global.tarde} con retraso`} tooltip={<><div className="font-bold text-white mb-1">Cumplieron</div><div className="space-y-0.5"><div className="flex justify-between gap-3"><span style={{color:C[1]}}>A tiempo:</span><span className="font-mono">{global.a_tiempo}</span></div><div className="flex justify-between gap-3"><span style={{color:C[2]}}>Con retraso:</span><span className="font-mono">{global.tarde}</span></div></div></>}/>
          <KpiCard label="En proceso" value={global.en_proceso} color="#3b82f6" icon="●" sub="sin reporte, dentro del plazo" tooltip="Registros activos que aún no han sido reportados pero están dentro del plazo establecido."/>
          <KpiCard label="Por vencer" value={global.por_vencer} color="#eab308" icon="⚡" sub="vencen en los próximos días" tooltip="Registros sin reporte cuya fecha límite está próxima. Requieren atención inmediata."/>
          <KpiCard label="Fuera de plazo" value={global.fuera} color="#ef4444" icon="❌" sub="sin reporte, plazo vencido" tooltip="Registros que superaron la fecha límite sin haber sido reportados. Generan penalidades."/>
          {global.pen_total>0&&<KpiCard label="Penalidades" value={fmtMoneda(global.pen_total)} color="#f43f5e" icon="💰" sub="acumulado en todos los módulos" small tooltip="Total de penalidades acumuladas por retrasos en todos los módulos."/>}
          {global.efic_prom!==null&&(()=>{const ei=getEficienciaLabel(global.efic_prom);return<KpiCard label="Eficiencia global" value={`${global.efic_prom}%`} color={ei.color} icon="📈" sub={ei.label} small tooltip={<><div className="font-bold text-white mb-1">Eficiencia global promedio</div><div className="text-gray-400">Promedio ponderado entre cumplimiento de cantidades y plazos. Nota: {ei.grade}</div></>}/>})()}
        </div>

        {/* Donut + Estado por módulo */}
        <div className="grid gap-4" style={{gridTemplateColumns:'320px 1fr'}}>
          <div className="card" style={{display:'flex',flexDirection:'column',gap:10}}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">🍩 Distribución global</div>
              <Tooltip content="Pasa el mouse sobre cada sector del donut para ver el detalle."><span className="text-xs text-gray-600 cursor-help">ℹ️</span></Tooltip>
            </div>
            {/* Donut + lista horizontal */}
            <div className="flex items-center gap-4 flex-1">
              <div className="flex-shrink-0">
                <Donut segs={segG} size={140} grosor={26} centro={<>
                  <div className="text-2xl font-bold font-mono text-white leading-none">{pctG}%</div>
                  <div className="text-xs text-gray-500 mt-0.5">cumplidos</div>
                  <div style={{fontSize:10}} className="text-gray-600">{global.cumplidos}/{global.total}</div>
                </>}/>
              </div>
              <div className="flex-1 space-y-2.5">
                {segG.map(s => {
                  const pct = global.total > 0 ? Math.round(s.n / global.total * 100) : 0
                  return (
                    <div key={s.label}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                          <span style={{fontSize:11,color:'#9ca3af'}}>{s.label}</span>
                        </div>
                        <span style={{fontSize:11,color:s.color,fontFamily:'monospace',fontWeight:700}}>{s.n}</span>
                      </div>
                      <div style={{height:5,background:'#1f2937',borderRadius:3,overflow:'hidden'}}>
                        <div style={{width:`${pct}%`,height:'100%',background:s.color,borderRadius:3,transition:'width 0.4s'}}/>
                      </div>
                      <div style={{fontSize:9,color:'#4b5563',marginTop:1,textAlign:'right'}}>{pct}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Barra total al fondo */}
            <Bar segs={segG} total={global.total} h={8}/>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">📁 Estado por módulo</div>
              <span className="text-xs text-gray-600">Clic en un módulo para ver su detalle</span>
            </div>
            <div className="space-y-2" style={{maxHeight:400,overflowY:'auto'}}>
              {xModulo.filter(m=>m.total>0).map(mod=>{
                const pct=mod.total>0?Math.round(mod.cumplidos/mod.total*100):0
                const segs=[{n:mod.a_tiempo,color:C[1],label:'A tiempo'},{n:mod.tarde,color:C[2],label:'Tarde'},{n:mod.en_proceso,color:C[3],label:'En proceso'},{n:mod.por_vencer,color:C[4],label:'Por vencer'},{n:mod.fuera,color:C[5],label:'Fuera'}]
                return (
                  <Tooltip key={mod.id} block content={<>
                    <div className="font-bold text-white mb-2">{mod.icono} {mod.nombre}</div>
                    <div className="space-y-0.5">
                      {segs.map(s=><div key={s.label} className="flex justify-between gap-3"><span style={{color:s.color}}>{s.label}:</span><span className="font-mono">{s.n} ({mod.total>0?Math.round(s.n/mod.total*100):0}%)</span></div>)}
                      {mod.pen_total>0&&<div className="flex justify-between gap-3 border-t border-gray-700 mt-1 pt-1"><span className="text-red-400">Penalidades:</span><span className="font-mono text-red-400">{fmtMoneda(mod.pen_total)}</span></div>}
                      {mod.efic_prom!==null&&<div className="flex justify-between gap-3"><span className="text-gray-400">Eficiencia prom:</span><span className="font-mono" style={{color:getEficienciaLabel(mod.efic_prom).color}}>{mod.efic_prom}%</span></div>}
                    </div>
                  </>}>
                    <div onClick={()=>setModActivo(String(mod.id))}
                      className="p-3 rounded-lg border border-gray-800 hover:border-blue-700 transition-all cursor-pointer"
                      style={{background:'#0d1526'}}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span>{mod.icono}</span>
                          <span className="text-xs font-medium text-gray-200">{mod.nombre}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {mod.efic_prom!==null&&(()=>{const ei=getEficienciaLabel(mod.efic_prom);return<span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{background:ei.color+'22',color:ei.color}}>⚡{mod.efic_prom}% {ei.grade}</span>})()}
                          {mod.pen_total>0&&<span className="text-xs text-red-400 font-mono">{fmtMoneda(mod.pen_total)}</span>}
                          {mod.fuera>0&&<span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{background:'#1c0101',color:'#f87171'}}>{mod.fuera} fuera</span>}
                          {mod.por_vencer>0&&<span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{background:'#2c1f00',color:'#fbbf24'}}>⚡{mod.por_vencer}</span>}
                          <span className="text-xs text-gray-600 font-mono">{mod.total} reg.</span>
                          <span className="text-xs text-blue-500">→</span>
                        </div>
                      </div>
                      <Bar segs={segs} total={mod.total} h={12}/>
                      <div className="flex justify-between mt-1.5">
                        <Leyenda items={LEYENDA_ESTADOS}/>
                        <span className="text-xs font-mono font-bold" style={{color:pct>=80?C[1]:pct>=50?C[4]:C[5]}}>{pct}% cumplidos</span>
                      </div>
                    </div>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        </div>

        {/* Semanas + Urgentes */}
        <div className="grid gap-4" style={{gridTemplateColumns:'1fr 340px'}}>
          <div className="card" style={{overflow:'visible'}}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">📅 Evolución por semana</div>
              <Tooltip content="Una línea por estado. Pasa el mouse sobre los puntos para ver el detalle por semana."><span className="text-xs text-gray-600 cursor-help">ℹ️</span></Tooltip>
            </div>
            <div className="mt-2">
              <SemanaChart data={xSemG}/>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">⚠️ Alertas urgentes</div>
              {urgentes.length>0&&<span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{background:'#1c0101',color:'#f87171',border:'1px solid #7f1d1d'}}>{urgentes.length}</span>}
            </div>
            {urgentes.length===0?(
              <div className="flex flex-col items-center justify-center py-8 text-gray-600"><div className="text-3xl mb-2">✅</div><div className="text-xs">Sin alertas urgentes</div></div>
            ):(
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {urgentes.map(ot=>{
                  const dias=getDiasRestantes(ot.fecha_limite_expedientes)
                  const urg=ot.estado===5?C[5]:C[4]
                  return (
                    <Tooltip key={ot.id} content={<>
                      <div className="font-bold text-white">{ot._mod?.icono} {ot._mod?.nombre}</div>
                      {ot._cont&&<div className="text-gray-400 text-xs mt-0.5">{ot._cont.nombre}</div>}
                      <div className="mt-1 space-y-0.5">
                        <div className="flex justify-between gap-3"><span className="text-gray-500">Límite:</span><span className="font-mono">{fmtFecha(ot.fecha_limite_expedientes)}</span></div>
                        {ot.actividad&&<div className="flex justify-between gap-3"><span className="text-gray-500">Actividad:</span><span>{ot.actividad}</span></div>}
                      </div>
                    </>}>
                      <div className="p-2.5 rounded-lg border cursor-pointer hover:border-gray-500 transition-all" style={{background:'#0d1526',borderColor:ot.estado===5?'#3b0a0a':'#2c1f00'}}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-200">{ot._mod?.icono} {ot._mod?.nombre}{ot.numero_ot&&<span className="text-gray-500"> · #{ot.numero_ot}</span>}</div>
                            {ot._cont&&<div className="text-xs text-gray-600 truncate mt-0.5">{ot._cont.nombre}</div>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-bold font-mono" style={{color:urg}}>{dias===null?'—':dias<0?`${Math.abs(dias)}d`:dias===0?'HOY':`${dias}d`}</div>
                            <div className="text-xs mt-0.5" style={{color:urg}}>{ot.estado===5?'Fuera de plazo':'Por vencer'}</div>
                          </div>
                        </div>
                      </div>
                    </Tooltip>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </>)}

      {/* ══════════ VISTA DE MÓDULO ══════════ */}
      {modSelec && (<>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{modSelec.icono}</span>
            <div>
              <h2 className="text-base font-bold text-white">{modSelec.nombre}</h2>
              <p className="text-xs text-gray-500">{modSelec.total} registros · Periodo {periodo}</p>
            </div>
          </div>
          <Link href={`/modulo/${modSelec.id}`} className="btn-ghost text-xs">Ver registros →</Link>
        </div>

        {/* KPIs módulo */}
        <div className="grid gap-3" style={{gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))'}}>
          {(()=>{
            const pct=modSelec.total>0?Math.round(modSelec.cumplidos/modSelec.total*100):0
            return <>
              <KpiCard label="Total" value={modSelec.total} color="#3b82f6" icon="📋" sub={`${modSelec.con_reporte} reportados · ${modSelec.total-modSelec.con_reporte} pendientes`}/>
              <KpiCard label="Cumplieron" value={modSelec.cumplidos} color="#22c55e" icon="✅" pct={pct} sub={`${modSelec.a_tiempo} a tiempo · ${modSelec.tarde} tarde`}/>
              <KpiCard label="En proceso" value={modSelec.en_proceso} color="#3b82f6" icon="●" sub="dentro del plazo"/>
              <KpiCard label="Por vencer" value={modSelec.por_vencer} color="#eab308" icon="⚡" sub="requieren atención"/>
              <KpiCard label="Fuera de plazo" value={modSelec.fuera} color="#ef4444" icon="❌" sub="generan penalidades"/>
              {modSelec.pen_total>0&&<KpiCard label="Penalidades" value={fmtMoneda(modSelec.pen_total)} color="#f43f5e" icon="💰" sub="total acumulado" small/>}
              {modSelec.efic_prom!==null&&(()=>{const ei=getEficienciaLabel(modSelec.efic_prom);return<KpiCard label="Eficiencia prom." value={`${modSelec.efic_prom}%`} color={ei.color} icon="📈" sub={`${ei.label} · Nota ${ei.grade}`} small tooltip={<><div className="font-bold text-white mb-1">Eficiencia promedio del módulo</div><div className="text-gray-400">{[1,2,3].includes(modSelec.id)?'Calcula 50% cumplimiento de cantidad + 50% cumplimiento de plazo.':'Basada en puntualidad, velocidad y anticipación del reporte.'}</div></>}/>})()}
            </>
          })()}
        </div>

        {/* Donut + Semanas */}
        <div className="grid gap-4" style={{gridTemplateColumns:'280px 1fr'}}>
          <div className="card" style={{display:'flex',flexDirection:'column',gap:12}}>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">🍩 Distribución del módulo</div>
            {(()=>{
              const segs=[{n:modSelec.a_tiempo,color:C[1],label:'A tiempo'},{n:modSelec.tarde,color:C[2],label:'Cumplió tarde'},{n:modSelec.en_proceso,color:C[3],label:'En proceso'},{n:modSelec.por_vencer,color:C[4],label:'Por vencer'},{n:modSelec.fuera,color:C[5],label:'Fuera de plazo'}]
              const pct=modSelec.total>0?Math.round(modSelec.cumplidos/modSelec.total*100):0
              return <>
                <div className="flex items-center gap-4">
                  <Donut segs={segs} size={110} grosor={20} centro={<><div className="text-lg font-bold font-mono text-white">{pct}%</div><div className="text-xs text-gray-500">cumplidos</div></>}/>
                  <div className="space-y-1.5 flex-1">
                    {segs.map(s=>(
                      <Tooltip key={s.label} content={<><div style={{color:s.color}} className="font-bold">{s.label}</div><div className="flex justify-between gap-3 mt-1"><span className="text-gray-400">Cantidad:</span><span className="font-mono">{s.n}</span></div><div className="flex justify-between gap-3"><span className="text-gray-400">%:</span><span className="font-mono">{modSelec.total>0?Math.round(s.n/modSelec.total*100):0}%</span></div></>}>
                        <div className="flex items-center gap-1.5 cursor-help">
                          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{background:s.color}}/>
                          <span className="text-xs text-gray-400 flex-1">{s.label}</span>
                          <span className="text-xs font-mono font-bold" style={{color:s.color}}>{s.n}</span>
                          <span className="text-xs text-gray-600" style={{minWidth:28,textAlign:'right'}}>{modSelec.total>0?Math.round(s.n/modSelec.total*100):0}%</span>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </div>
                <Bar segs={segs} total={modSelec.total} h={7}/>
                <Leyenda items={LEYENDA_ESTADOS}/>
              </>
            })()}
          </div>

          <div className="card" style={{overflow:'visible'}}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">📅 Evolución por semana</div>
              <Tooltip content="Una línea por estado. Pasa el mouse sobre los puntos para ver el detalle por semana."><span className="text-xs text-gray-600 cursor-help">ℹ️</span></Tooltip>
            </div>
            <div className="mt-2">
              <SemanaChart data={modSelec.xSemana}/>
            </div>
          </div>
        </div>

        {/* Ranking de contratistas — solo módulos OT */}
        {modSelec.tipo==='ot' && modSelec.xCont.length>0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">🏆 Ranking de contratistas</div>
                <div className="text-xs text-gray-600 mt-0.5">Ordenado por eficiencia · Pasa el mouse para ver detalle</div>
              </div>
              <Leyenda items={[['Cumplidos','#22c55e'],['En proceso','#3b82f6'],['Fuera','#ef4444']]}/>
            </div>
            <div className="space-y-3">
              {modSelec.xCont.map((c,i)=>{
                const ei     = getEficienciaLabel(c.efic_prom)
                const medals = ['🥇','🥈','🥉']
                const pctCant = c.cantidad_prog>0 ? Math.round(c.cantidad_entr/c.cantidad_prog*100) : null
                return (
                  <Tooltip key={c.id} block content={<>
                    <div className="font-bold text-white mb-2">{medals[i]||`#${i+1}`} {c.nombre}</div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between gap-3"><span className="text-gray-400">Total registros:</span><span className="font-mono">{c.total}</span></div>
                      <div className="flex justify-between gap-3"><span style={{color:C[1]}}>A tiempo:</span><span className="font-mono">{c.a_tiempo} ({c.total>0?Math.round(c.a_tiempo/c.total*100):0}%)</span></div>
                      <div className="flex justify-between gap-3"><span style={{color:C[2]}}>Con retraso:</span><span className="font-mono">{c.tarde}</span></div>
                      <div className="flex justify-between gap-3"><span style={{color:C[5]}}>Fuera de plazo:</span><span className="font-mono">{c.fuera}</span></div>
                      {c.pen>0&&<div className="flex justify-between gap-3"><span className="text-red-400">Penalidad:</span><span className="font-mono text-red-400">{fmtMoneda(c.pen)}</span></div>}
                      {pctCant!==null&&<div className="flex justify-between gap-3"><span className="text-gray-400">Cant. entregada:</span><span className="font-mono">{c.cantidad_entr}/{c.cantidad_prog} ({pctCant}%)</span></div>}
                      <div className="border-t border-gray-700 mt-1 pt-1 flex justify-between"><span className="text-gray-400">Eficiencia:</span><span className="font-mono font-bold" style={{color:ei.color}}>{c.efic_prom!==null?`${c.efic_prom}% (${ei.grade})`:'Sin datos'}</span></div>
                    </div>
                  </>}>
                    <div className="p-3 rounded-lg border border-gray-800 hover:border-gray-600 transition-all cursor-help" style={{background:'#0d1526'}}>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg flex-shrink-0">{medals[i]||<span className="text-xs text-gray-500 font-mono w-5 text-center">#{i+1}</span>}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0"><div className="w-2.5 h-2.5 rounded-full" style={{background:c.color||'#6b7280'}}/></div>
                        <span className="text-xs font-medium text-gray-200 flex-1 truncate">{c.nombre}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {c.pen>0&&<span className="text-xs text-red-400 font-mono">{fmtMoneda(c.pen)}</span>}
                          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{background:ei.color+'22',color:ei.color}}>{c.efic_prom!==null?`${c.efic_prom}% · ${ei.grade}`:'—'}</span>
                          <span className="text-xs text-gray-500 font-mono">{c.pct_cumpl}% cumplió</span>
                        </div>
                      </div>
                      <Bar segs={[{n:c.cumplidos,color:'#22c55e',label:'Cumplidos'},{n:c.en_proceso,color:'#3b82f6',label:'En proceso'},{n:c.fuera,color:C[5],label:'Fuera'}]} total={c.total} h={8}/>
                      {modSelec.tiene_cantidad && c.cantidad_prog>0 && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-gray-600">Cantidad entregada</span>
                            <span className="font-mono text-gray-400">{c.cantidad_entr}/{c.cantidad_prog} ({pctCant??0}%)</span>
                          </div>
                          <div style={{height:4,background:'#1f2937',borderRadius:2,overflow:'hidden'}}>
                            <div style={{width:`${pctCant??0}%`,height:'100%',background:pctCant>=100?'#22c55e':pctCant>=80?'#eab308':'#ef4444'}}/>
                          </div>
                        </div>
                      )}
                    </div>
                  </Tooltip>
                )
              })}
            </div>
            {modSelec.pen_total>0&&(
              <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between items-center">
                <span className="text-xs font-bold text-gray-400">Total penalidades del módulo</span>
                <span className="text-xl font-bold font-mono text-red-400">{fmtMoneda(modSelec.pen_total)}</span>
              </div>
            )}
          </div>
        )}

        {/* Módulo libre */}
        {modSelec.tipo==='libre' && (
          <div className="card">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📋 Resumen de registros</div>
            <div className="grid grid-cols-3 gap-3">
              {[['Con reporte',modSelec.con_reporte,'#22c55e','Registros que ya tienen fecha de reporte registrada.'],
                ['Sin reporte',modSelec.total-modSelec.con_reporte,'#6b7280','Registros pendientes de reporte.'],
                ['Fuera de plazo',modSelec.fuera,'#ef4444','Registros cuyo plazo venció sin reporte.']].map(([l,v,c,tip])=>(
                <Tooltip key={l} content={<><div className="font-bold" style={{color:c}}>{l}</div><div className="text-gray-400 mt-1">{tip}</div><div className="font-mono mt-1">{v} registros · {modSelec.total>0?Math.round(v/modSelec.total*100):0}%</div></>}>
                  <div className="p-3 rounded-xl border border-gray-800 cursor-help" style={{background:'#0d1526'}}>
                    <div className="text-2xl font-bold font-mono" style={{color:c}}>{v}</div>
                    <div className="text-xs text-gray-500 mt-1">{l}</div>
                    <div className="mt-2" style={{height:3,background:'#1f2937',borderRadius:2}}>
                      <div style={{width:`${modSelec.total>0?Math.round(v/modSelec.total*100):0}%`,height:'100%',background:c,borderRadius:2}}/>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">{modSelec.total>0?Math.round(v/modSelec.total*100):0}%</div>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </>)}
    </div>
  )
}
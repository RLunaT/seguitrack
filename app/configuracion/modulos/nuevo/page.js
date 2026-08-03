'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

const ICONOS = ['📋','⚡','🔄','🆕','📄','📁','🔍','🏗️','🔧','📊','📅','🎯','⚠️','✅','🔔','🌐','📢','🏛️','📌','🗂️']
const COLORES = ['#3b82f6','#22c55e','#eab308','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#a855f7','#2E75B6','#70AD47']

// Columnas base del sistema — nunca en DB, siempre calculadas
const COLS_BASE = [
  { key: 'numero_ot',          label: 'N° OT',           defaultOn: true  },
  { key: 'contratista',        label: 'Contratista',      defaultOn: false },
  { key: 'actividad',          label: 'Actividad',        defaultOn: true  },
  { key: 'motivo_ot',          label: 'Motivo OT',        defaultOn: false },
  { key: 'semana',             label: 'Semana',           defaultOn: true  },
  { key: 'contrato',           label: 'Contrato',         defaultOn: false },
  { key: 'progreso',           label: 'Progreso',         defaultOn: true  },
  { key: 'fecha_inicio',       label: 'F. Inicio',        defaultOn: true  },
  { key: 'fecha_fin_trabajos', label: 'F. Fin Trab.',     defaultOn: false },
  { key: 'fecha_limite',       label: 'F. Límite Exp.',   defaultOn: true  },
  { key: 'dias_plazo',         label: 'Días Ejec.',       defaultOn: true  },
  { key: 'cantidad',           label: 'Cantidad',         defaultOn: false },
  { key: 'fecha_reporte',      label: 'F. Reporte',       defaultOn: true  },
  { key: 'estado',             label: 'Estado',           defaultOn: true  },
  { key: 'duracion_real',      label: 'Dur. Real',        defaultOn: false },
  { key: 'dias_fuera',         label: 'D. Fuera Plazo',   defaultOn: false },
  { key: 'val_pen',            label: 'Val. Pen.',        defaultOn: false },
  { key: 'val_total',          label: 'Val. Total Pen.',  defaultOn: false },
  { key: 'observaciones',      label: 'Observaciones',    defaultOn: true  },
  { key: 'eficiencia',         label: 'Eficiencia',       defaultOn: false },
  { key: 'accion_doc',         label: 'Btn. Documento',   defaultOn: false },
]

const SIEMPRE = ['estado', 'fecha_limite'] // no se pueden quitar

function colLetra(n) {
  let s = '', x = n + 1
  while (x > 0) { x--; s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) }
  return s
}

export default function NuevoModuloPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const periodoDeUrl = searchParams.get('periodo')
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    nombre: '', descripcion: '', icono: '📋', color: '#3b82f6',
    periodo: periodoDeUrl || '2026-I', tipo: 'ot', actividades: '', motivos: '', tiene_penalidad: false,
    plantilla_titulo: '', plantilla_cumplimiento: '', plantilla_actividad: '', plantilla_editado_por: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Lista unificada de columnas (base ON + personalizadas) ──
  // Cada item: { type:'base', key } | { type:'extra', id, nombre, tipo, opciones, obligatorio }
  const [columnas, setColumnas] = useState(
    COLS_BASE.filter(c => c.defaultOn).map(c => ({ type: 'base', key: c.key }))
  )

  // Columnas base NO activas (para agregar)
  const baseActivas = columnas.filter(c => c.type === 'base').map(c => c.key)
  const baseDisponibles = COLS_BASE.filter(c => !baseActivas.includes(c.key))

  // Modal agregar campo personalizado
  const [modalCampo, setModalCampo] = useState(false)
  const [nuevoC, setNuevoC] = useState({ nombre: '', tipo: 'texto', opciones: '', obligatorio: false, insertarEn: -1 })

  function moverCol(idx, dir) {
    setColumnas(prev => {
      const arr = [...prev]
      const target = idx + dir
      if (target < 0 || target >= arr.length) return arr
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return arr
    })
  }

  function quitarCol(idx) {
    const col = columnas[idx]
    if (col.type === 'base' && SIEMPRE.includes(col.key)) return
    setColumnas(prev => prev.filter((_, i) => i !== idx))
    if (col.type === 'base' && col.key === 'val_total') setForm(p => ({ ...p, tiene_penalidad: false }))
  }

  function agregarBase(key) {
    if (key === 'val_total') {
      setForm(p => ({ ...p, tiene_penalidad: true }))
      setColumnas(prev => {
        const next = [...prev]
        if (!next.find(c => c.type === 'base' && c.key === 'contratista'))
          next.push({ type: 'base', key: 'contratista' })
        if (!next.find(c => c.type === 'base' && c.key === 'val_pen'))
          next.push({ type: 'base', key: 'val_pen' })
        next.push({ type: 'base', key: 'val_total' })
        return next
      })
    } else {
      setColumnas(prev => [...prev, { type: 'base', key }])
    }
  }

  function agregarExtra() {
    if (!nuevoC.nombre) return
    const clave = nuevoC.nombre.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')
    const item = { type: 'extra', id: Date.now(), nombre: nuevoC.nombre, clave, tipo: nuevoC.tipo, opciones: nuevoC.opciones, obligatorio: nuevoC.obligatorio }
    setColumnas(prev => {
      const arr = [...prev]
      const pos = nuevoC.insertarEn === -1 ? arr.length : nuevoC.insertarEn + 1
      arr.splice(pos, 0, item)
      return arr
    })
    setNuevoC({ nombre: '', tipo: 'texto', opciones: '', obligatorio: false, insertarEn: -1 })
    setModalCampo(false)
  }

  // Lista completa para preview: N°Reg (fijo) + columnas + Acciones (fijo)
  const preview = [
    { label: 'N° Reg.', fixed: true },
    ...columnas.map(c => c.type === 'base'
      ? { label: COLS_BASE.find(b => b.key === c.key)?.label || c.key, isBase: true }
      : { label: c.nombre, isExtra: true }
    ),
    { label: 'Acciones', fixed: true },
  ]

  const tienePenalidades = columnas.some(c => c.type === 'base' && (c.key === 'val_total' || c.key === 'val_pen'))

  async function guardar() {
    if (!form.nombre) { setError('El nombre es requerido'); return }
    setSaving(true)
    const { data: mod, error: err } = await supabase.from('modulos').insert({
      nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null,
      icono: form.icono, color: form.color, tipo: form.tipo,
      actividades: JSON.stringify(form.tipo === 'ot' ? form.actividades.split(',').map(a=>a.trim()).filter(Boolean) : []),
      motivos: JSON.stringify(form.tipo === 'ot' ? form.motivos.split(',').map(m=>m.trim()).filter(Boolean) : []),
      tiene_penalidad: form.tiene_penalidad,
      plantilla_titulo: form.plantilla_titulo || null,
      plantilla_cumplimiento: form.plantilla_cumplimiento || null,
      plantilla_actividad: form.plantilla_actividad || null,
      plantilla_editado_por: form.plantilla_editado_por || null,
      periodo: form.periodo.trim() || '2026-I',
      activo: true, orden: 99,
    }).select().single()
    if (err) { setError(err.message); setSaving(false); return }

    // Guardar campos extra con su orden real en la lista unificada
    const extras = columnas.filter(c => c.type === 'extra')
    if (extras.length > 0) {
      // orden = posición en columnas[] para mantener el orden relativo correcto
      await supabase.from('modulo_campos').insert(
        extras.map(c => ({
          modulo_id: mod.id, nombre: c.nombre, clave: c.clave, tipo: c.tipo,
          opciones: c.opciones || null, obligatorio: c.obligatorio, en_tabla: true,
          orden: columnas.indexOf(c),
        }))
      )
    }

    // Guardar visibilidad de columnas base
    const colsVisibles = {}
    COLS_BASE.forEach(b => { colsVisibles[b.key] = baseActivas.includes(b.key) })
    if (typeof window !== 'undefined') {
      localStorage.setItem(`cols_${mod.id}`, JSON.stringify(colsVisibles))
      // Guardar orden unificado usando clave (estable) en vez de id temporal
      const ordenUnificado = columnas.map(c => c.type === 'base' ? c.key : c.clave)
      localStorage.setItem(`cols_order_${mod.id}`, JSON.stringify(ordenUnificado))
    }

    setSaving(false)
    router.push(`/modulo/${mod.id}`)
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">➕ Crear Nuevo Módulo</h1>
          <p className="text-gray-400 text-sm mt-1">Define la estructura de tu nuevo módulo</p>
        </div>
        <div className="ml-auto flex gap-2">
          {[{n:1,l:'Info'},{n:2,l:'Columnas'},{n:3,l:'Plantilla'}].map(s=>(
            <div key={s.n} onClick={()=>form.nombre&&setStep(s.n)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all ${step===s.n?'bg-blue-600 text-white':step>s.n?'bg-green-800 text-green-200':'bg-gray-800 text-gray-500'}`}>
              {step>s.n?'✓':s.n} {s.l}
            </div>
          ))}
        </div>
      </div>

      {/* ── PASO 1 ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-gray-300">📌 Información básica</h2>
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre del módulo *</label>
              <input className="input-base" placeholder="Ej: Instalaciones Nuevas, P228..." value={form.nombre} onChange={e=>setForm(p=>({...p,nombre:e.target.value}))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Descripción</label>
              <input className="input-base" placeholder="Breve descripción" value={form.descripcion} onChange={e=>setForm(p=>({...p,descripcion:e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-2">Ícono</label>
                <div className="flex flex-wrap gap-1.5">
                  {ICONOS.map(ico=>(
                    <button key={ico} onClick={()=>setForm(p=>({...p,icono:ico}))}
                      className={`text-lg p-1.5 rounded-lg transition-all ${form.icono===ico?'bg-blue-900 ring-1 ring-blue-500':'hover:bg-gray-800'}`}>{ico}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLORES.map(col=>(
                    <button key={col} onClick={()=>setForm(p=>({...p,color:col}))}
                      className={`w-8 h-8 rounded-lg transition-all ${form.color===col?'ring-2 ring-white ring-offset-1 ring-offset-gray-900':''}`}
                      style={{background:col}} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg" style={{background:`${form.color}15`,border:`1px solid ${form.color}30`}}>
              <span className="text-2xl">{form.icono}</span>
              <div>
                <div className="text-sm font-semibold" style={{color:form.color}}>{form.nombre||'Nombre del módulo'}</div>
                <div className="text-xs text-gray-500">{form.descripcion||'Descripción...'}</div>
              </div>
            </div>
          </div>
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-gray-300">🔧 Tipo</h2>
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Tipo de módulo</label>
              <select className="input-base" value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))}>
                <option value="ot">OT (Orden de Trabajo)</option>
                <option value="libre">Libre (registro genérico)</option>
              </select>
            </div>
            {form.tipo==='ot' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Actividades <span className="text-gray-600">(opcional, separadas por coma)</span></label>
                  <input className="input-base" placeholder="Ej: Contraste, Avisos" value={form.actividades} onChange={e=>setForm(p=>({...p,actividades:e.target.value}))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Motivos OT <span className="text-gray-600">(opcional, separados por coma)</span></label>
                  <input className="input-base" placeholder="Ej: P-227, NTCSE Urbano" value={form.motivos} onChange={e=>setForm(p=>({...p,motivos:e.target.value}))} />
                </div>
              </div>
            )}
          </div>
          {error&&<div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">❌ {error}</div>}
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={()=>router.back()}>Cancelar</button>
            <button className="btn-primary" onClick={()=>{if(!form.nombre){setError('El nombre es requerido');return};setError('');setStep(2)}}>
              Siguiente → Columnas y Campos
            </button>
          </div>
        </div>
      )}

      {/* ── PASO 2 ── */}
      {step === 2 && (
        <div className="space-y-4">

          {/* Vista previa */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-300">Vista previa de la tabla</span>
              <span className="text-xs text-gray-600">{preview.length} columnas en total</span>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-1 items-end flex-nowrap min-w-max">
                {preview.map((c,i)=>(
                  <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className="text-xs font-bold px-2 py-0.5 rounded text-center"
                      style={{background:c.fixed?'#1f2937':c.isExtra?'#3b1f6b':'#1e3a5f', color:c.fixed?'#6b7280':c.isExtra?'#c4b5fd':'#93c5fd', border:'1px solid #2d4a6b', minWidth:28}}>
                      {colLetra(i)}
                    </div>
                    <div className="text-xs text-center px-1.5 py-1 rounded"
                      style={{background:c.fixed?'#111827':c.isExtra?'#1e1b4b':'#0f172a', color:c.fixed?'#4b5563':c.isExtra?'#a78bfa':'#d1d5db', border:'1px solid #374151', maxWidth:68, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                      title={c.label}>{c.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-4 mt-1.5 text-xs text-gray-600">
              <span>🔵 Base</span><span>🟣 Personalizada</span><span>⬜ Fija</span>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-4">
            {/* Columnas activas — lista reordenable */}
            <div className="card col-span-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide">Orden de columnas</h3>
                <button className="btn-primary text-xs" onClick={()=>{setNuevoC({nombre:'',tipo:'texto',opciones:'',obligatorio:false,insertarEn:columnas.length-1});setModalCampo(true)}}>
                  + Campo personalizado
                </button>
              </div>
              <p className="text-xs text-gray-600 mb-3">Usa ↑↓ para reordenar. Haz clic en ✕ para quitar. Los personalizados (🟣) pueden ir en cualquier posición.</p>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {columnas.map((col, idx) => {
                  const isBase = col.type === 'base'
                  const meta = isBase ? COLS_BASE.find(b=>b.key===col.key) : null
                  const label = isBase ? meta?.label : col.nombre
                  const isFixed = isBase && SIEMPRE.includes(col.key)
                  return (
                    <div key={isBase?col.key:col.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded border ${isBase?'border-blue-900 bg-blue-950':'border-purple-900 bg-purple-950'}`}>
                      <span className="text-xs font-bold w-6 text-center font-mono" style={{color:isBase?'#93c5fd':'#c4b5fd'}}>{colLetra(idx+1)}</span>
                      <span className={`text-xs ${isBase?'text-gray-200':'text-purple-200'} flex-1`}>{label}</span>
                      {col.key==='val_total'&&<span className="text-xs text-yellow-500">💰</span>}
                      {col.key==='accion_doc'&&<span className="text-xs text-blue-400">📄</span>}
                      {!isBase&&<span className="text-xs text-purple-400 bg-purple-900 px-1 rounded">{col.tipo}</span>}
                      <div className="flex gap-0.5 ml-1">
                        <button className="text-gray-600 hover:text-gray-200 px-1 text-xs rounded hover:bg-gray-800" onClick={()=>moverCol(idx,-1)} disabled={idx===0}>↑</button>
                        <button className="text-gray-600 hover:text-gray-200 px-1 text-xs rounded hover:bg-gray-800" onClick={()=>moverCol(idx,1)} disabled={idx===columnas.length-1}>↓</button>
                        {!isFixed && <button className="text-red-600 hover:text-red-400 px-1 text-xs rounded hover:bg-red-950" onClick={()=>quitarCol(idx)}>✕</button>}
                        {!isBase && (
                          <button className="text-purple-600 hover:text-purple-400 px-1 text-xs rounded hover:bg-purple-950"
                            onClick={()=>{setNuevoC({nombre:col.nombre,tipo:col.tipo,opciones:col.opciones||'',obligatorio:col.obligatorio,insertarEn:idx-1});setColumnas(p=>p.filter((_,i)=>i!==idx));setModalCampo(true)}}>✏️</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Panel derecho: columnas base disponibles */}
            <div className="card col-span-2">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Columnas disponibles</h3>
              <p className="text-xs text-gray-600 mb-3">Clic para agregar al final, luego usa ↑↓ para posicionar.</p>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {baseDisponibles.length === 0
                  ? <div className="text-xs text-gray-600 py-3 text-center">Todas las columnas están activas</div>
                  : baseDisponibles.map(col=>(
                    <button key={col.key} onClick={()=>agregarBase(col.key)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800 hover:border-blue-700 hover:bg-blue-950 text-left transition-all">
                      <span className="text-blue-500 text-xs font-bold">+</span>
                      <span className="text-xs text-gray-400 flex-1">{col.label}</span>
                      {col.key==='val_total'&&<span className="text-xs text-yellow-600">💰</span>}
                      {col.key==='accion_doc'&&<span className="text-xs text-blue-600">📄</span>}
                    </button>
                  ))
                }
              </div>
            </div>
          </div>

          {tienePenalidades && (
            <div className="p-3 rounded-lg bg-yellow-950 border border-yellow-800 text-xs text-yellow-300">
              💰 <strong>Penalidades activadas.</strong> Configura las tasas en Sistema → Contratistas.
            </div>
          )}

          <div className="flex gap-3">
            <button className="btn-ghost" onClick={()=>setStep(1)}>← Atrás</button>
            <button className="btn-primary" onClick={()=>setStep(3)}>Siguiente → Plantilla</button>
            <button className="btn-ghost ml-auto" onClick={guardar} disabled={saving}>{saving?'⏳...':'✅ Guardar sin plantilla'}</button>
          </div>
        </div>
      )}

      {/* ── PASO 3 ── */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-gray-300">📄 Plantilla de documento (Word/PDF)</h2>
            <p className="text-xs text-gray-500">Opcional. Si se completa, aparecerá el botón para generar documentos.</p>
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Título del documento</label>
              <input className="input-base" placeholder="ORDEN DE TRABAJO - VERIFICACIÓN POSTERIOR..." value={form.plantilla_titulo} onChange={e=>setForm(p=>({...p,plantilla_titulo:e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Resolución de cumplimiento</label>
                <input className="input-base" placeholder="RESOLUCIÓN N° 227-2013-OS/CD" value={form.plantilla_cumplimiento} onChange={e=>setForm(p=>({...p,plantilla_cumplimiento:e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad del documento</label>
                <input className="input-base" placeholder="Verificación posterior medidores..." value={form.plantilla_actividad} onChange={e=>setForm(p=>({...p,plantilla_actividad:e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-400 block mb-1">Editado por / Cargo</label>
                <input className="input-base" placeholder="ANALISTA DE NORMALIZACIÓN DE CONEXIONES" value={form.plantilla_editado_por} onChange={e=>setForm(p=>({...p,plantilla_editado_por:e.target.value}))} />
              </div>
            </div>
          </div>
          {error&&<div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">❌ {error}</div>}
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={()=>setStep(2)}>← Atrás</button>
            <button className="btn-primary" onClick={guardar} disabled={saving}>{saving?'⏳ Creando...':'✅ Crear Módulo'}</button>
          </div>
        </div>
      )}

      {/* ── MODAL Campo personalizado ── */}
      {modalCampo && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setModalCampo(false)}}>
          <div className="modal-box" style={{maxWidth:480}}>
            <div className="modal-header">
              <h2 className="text-base font-bold text-white">🟣 Nuevo campo personalizado</h2>
              <button onClick={()=>setModalCampo(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre del campo *</label>
                <input className="input-base" placeholder="Ej: Zona, N° Suministro, Resultado..."
                  value={nuevoC.nombre} onChange={e=>setNuevoC(p=>({...p,nombre:e.target.value}))} autoFocus />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Tipo de dato</label>
                <div className="grid grid-cols-4 gap-2">
                  {[{v:'texto',icon:'📝',l:'Texto'},{v:'numero',icon:'🔢',l:'Número'},{v:'fecha',icon:'📅',l:'Fecha'},{v:'lista',icon:'📋',l:'Lista'}].map(t=>(
                    <button key={t.v} type="button" onClick={()=>setNuevoC(p=>({...p,tipo:t.v}))}
                      className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs font-medium transition-all ${nuevoC.tipo===t.v?'border-purple-500 bg-purple-950 text-purple-300':'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
                      <span className="text-lg">{t.icon}</span>{t.l}
                    </button>
                  ))}
                </div>
              </div>
              {nuevoC.tipo==='lista'&&(
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Opciones (separadas por coma)</label>
                  <input className="input-base" placeholder="Ej: Aprobado, Rechazado, Pendiente"
                    value={nuevoC.opciones} onChange={e=>setNuevoC(p=>({...p,opciones:e.target.value}))} />
                </div>
              )}

              {/* ── Posición — el núcleo de la mejora ── */}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">📍 ¿Entre qué columnas insertarlo?</label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-800 rounded-lg p-2 bg-gray-900">
                  <button type="button"
                    className={`w-full text-left text-xs px-3 py-1.5 rounded transition-all ${nuevoC.insertarEn===-1?'bg-purple-900 text-purple-200 border border-purple-600':'text-gray-400 hover:bg-gray-800'}`}
                    onClick={()=>setNuevoC(p=>({...p,insertarEn:-1}))}>
                    ↖ Al inicio (antes de todas las columnas)
                  </button>
                  {columnas.map((col, idx)=>{
                    const label = col.type==='base' ? COLS_BASE.find(b=>b.key===col.key)?.label : col.nombre
                    const isExtra = col.type==='extra'
                    return (
                      <button key={idx} type="button"
                        className={`w-full text-left text-xs px-3 py-1.5 rounded transition-all flex items-center gap-2 ${nuevoC.insertarEn===idx?'bg-purple-900 text-purple-200 border border-purple-600':'text-gray-400 hover:bg-gray-800'}`}
                        onClick={()=>setNuevoC(p=>({...p,insertarEn:idx}))}>
                        <span className="font-mono font-bold" style={{color:isExtra?'#c4b5fd':'#93c5fd'}}>{colLetra(idx+1)}</span>
                        <span className="flex-1">{label}</span>
                        <span className="text-gray-600">→ insertar aquí</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {nuevoC.insertarEn===-1 ? '→ Quedará en la primera posición' : `→ Quedará después de "${nuevoC.insertarEn < columnas.length ? (columnas[nuevoC.insertarEn].type==='base' ? COLS_BASE.find(b=>b.key===columnas[nuevoC.insertarEn].key)?.label : columnas[nuevoC.insertarEn].nombre) : ''}"`}
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-blue-500" checked={nuevoC.obligatorio}
                  onChange={e=>setNuevoC(p=>({...p,obligatorio:e.target.checked}))} />
                <span className="text-xs text-gray-300">Campo obligatorio al crear un registro</span>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={()=>setModalCampo(false)}>Cancelar</button>
              <button className="btn-primary" onClick={agregarExtra} disabled={!nuevoC.nombre}>➕ Insertar campo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
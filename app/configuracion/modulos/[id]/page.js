'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

const ICONOS = ['📋','⚡','🔄','🆕','📄','📁','🔍','🏗️','🔧','📊','📅','🎯','⚠️','✅','🔔','🌐','📢','🏛️','📌','🗂️']
const COLORES = ['#3b82f6','#22c55e','#eab308','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#a855f7','#2E75B6','#70AD47']

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

const SIEMPRE = ['estado', 'fecha_limite']

export default function EditarModuloPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm] = useState({
    nombre:'', descripcion:'', icono:'📋', color:'#3b82f6',
    periodo:'2026-I', tipo:'ot', actividades:'', motivos:'', tiene_penalidad:false,
    plantilla_titulo:'', plantilla_cumplimiento:'', plantilla_actividad:'', plantilla_editado_por:'',
  })

  useEffect(() => {
    async function cargar() {
      const { data: mod } = await supabase.from('modulos').select('*').eq('id', id).single()
      if (!mod) { router.push('/configuracion'); return }
      const acts = Array.isArray(mod.actividades) ? mod.actividades.join(', ') : JSON.parse(mod.actividades||'[]').join(', ')
      const mots = Array.isArray(mod.motivos)     ? mod.motivos.join(', ')     : JSON.parse(mod.motivos||'[]').join(', ')
      setForm({
        nombre:               mod.nombre || '',
        descripcion:          mod.descripcion || '',
        periodo:              mod.periodo || '2026-I',
        icono:                mod.icono || '📋',
        color:                mod.color || '#3b82f6',
        tipo:                 mod.tipo || 'ot',
        actividades:          acts,
        motivos:              mots,
        tiene_penalidad:      mod.tiene_penalidad || false,
        plantilla_titulo:     mod.plantilla_titulo || '',
        plantilla_cumplimiento: mod.plantilla_cumplimiento || '',
        plantilla_actividad:  mod.plantilla_actividad || '',
        plantilla_editado_por: mod.plantilla_editado_por || '',
      })
      setLoading(false)
    }
    cargar()
  }, [id])

  async function guardar() {
    if (!form.nombre) { setError('El nombre es requerido'); return }
    setSaving(true)
    const { error: err } = await supabase.from('modulos').update({
      nombre:               form.nombre.trim(),
      descripcion:          form.descripcion.trim() || null,
      periodo:              form.periodo.trim() || '2026-I',
      icono:                form.icono,
      color:                form.color,
      tipo:                 form.tipo,
      actividades:          JSON.stringify(form.tipo==='ot' ? form.actividades.split(',').map(a=>a.trim()).filter(Boolean) : []),
      motivos:              JSON.stringify(form.tipo==='ot' ? form.motivos.split(',').map(m=>m.trim()).filter(Boolean) : []),
      tiene_penalidad:      form.tiene_penalidad,
      plantilla_titulo:     form.plantilla_titulo || null,
      plantilla_cumplimiento: form.plantilla_cumplimiento || null,
      plantilla_actividad:  form.plantilla_actividad || null,
      plantilla_editado_por: form.plantilla_editado_por || null,
    }).eq('id', id)

    if (err) { setError(err.message); setSaving(false); return }
    router.push('/configuracion')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.push('/configuracion')} className="btn-ghost text-xs">← Volver</button>
        <div>
          <h1 className="text-xl font-bold text-white">✏️ Editar Módulo</h1>
          <p className="text-gray-400 text-sm mt-0.5">Modificar configuración de {form.nombre}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Info básica */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">📌 Información básica</h2>
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre del módulo *</label>
            <input className="input-base" value={form.nombre} onChange={e=>setForm(p=>({...p,nombre:e.target.value}))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Período</label>
            <input className="input-base" placeholder="Ej: 2026-I, 2026-II, 2027-I"
              value={form.periodo} onChange={e=>setForm(p=>({...p,periodo:e.target.value}))} />
            <p className="text-xs text-gray-600 mt-1">Año-Semestre. Agrupa los módulos en el menú lateral.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Descripción</label>
            <input className="input-base" value={form.descripcion} onChange={e=>setForm(p=>({...p,descripcion:e.target.value}))} />
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
          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-lg" style={{background:`${form.color}15`,border:`1px solid ${form.color}30`}}>
            <span className="text-2xl">{form.icono}</span>
            <div>
              <div className="text-sm font-semibold" style={{color:form.color}}>{form.nombre}</div>
              <div className="text-xs text-gray-500">{form.descripcion||'Sin descripción'}</div>
            </div>
          </div>
        </div>

        {/* Tipo y actividades */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">🔧 Tipo y actividades</h2>
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
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  Actividades <span className="text-gray-600">(separadas por coma)</span>
                </label>
                <input className="input-base" placeholder="Ej: Contraste, Avisos"
                  value={form.actividades} onChange={e=>setForm(p=>({...p,actividades:e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  Motivos OT <span className="text-gray-600">(separados por coma)</span>
                </label>
                <input className="input-base" placeholder="Ej: P-227, NTCSE Urbano, NTCSE Rural"
                  value={form.motivos} onChange={e=>setForm(p=>({...p,motivos:e.target.value}))} />
                <p className="text-xs text-gray-600 mt-1">Separa cada motivo con una coma</p>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="accent-blue-500" checked={form.tiene_penalidad}
              onChange={e=>setForm(p=>({...p,tiene_penalidad:e.target.checked}))} />
            <span className="text-xs text-gray-300">💰 Este módulo maneja penalidades</span>
          </label>
        </div>

        {/* Plantilla Word */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">📄 Plantilla de documento (Word/PDF)</h2>
          <p className="text-xs text-gray-500">Opcional. Si se completa, aparecerá el botón para generar documentos.</p>
          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Título del documento</label>
            <input className="input-base" placeholder="ORDEN DE TRABAJO - VERIFICACIÓN POSTERIOR..."
              value={form.plantilla_titulo} onChange={e=>setForm(p=>({...p,plantilla_titulo:e.target.value}))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Resolución de cumplimiento</label>
              <input className="input-base" placeholder="RESOLUCIÓN N° 227-2013-OS/CD"
                value={form.plantilla_cumplimiento} onChange={e=>setForm(p=>({...p,plantilla_cumplimiento:e.target.value}))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad del documento</label>
              <input className="input-base" placeholder="Verificación posterior medidores..."
                value={form.plantilla_actividad} onChange={e=>setForm(p=>({...p,plantilla_actividad:e.target.value}))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-400 block mb-1">Editado por / Cargo</label>
              <input className="input-base" placeholder="ANALISTA DE NORMALIZACIÓN DE CONEXIONES"
                value={form.plantilla_editado_por} onChange={e=>setForm(p=>({...p,plantilla_editado_por:e.target.value}))} />
            </div>
          </div>
        </div>

        {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">❌ {error}</div>}

        <div className="flex gap-3">
          <button className="btn-ghost" onClick={() => router.push('/configuracion')}>Cancelar</button>
          <button className="btn-primary" onClick={guardar} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
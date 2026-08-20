'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// Feriados peruanos fijos (año variable)
function getFeriados(anio) {
  return [
    `${anio}-01-01`, `${anio}-04-17`, `${anio}-04-18`,
    `${anio}-05-01`, `${anio}-06-29`, `${anio}-07-28`, `${anio}-07-29`,
    `${anio}-08-30`, `${anio}-10-08`, `${anio}-11-01`, `${anio}-12-08`, `${anio}-12-25`,
  ]
}

function addDiasHabiles(fechaStr, dias) {
  if (!fechaStr || dias === undefined) return ''
  const dt = new Date(fechaStr + 'T00:00:00')
  const anio = dt.getFullYear()
  const feriados = new Set(getFeriados(anio).concat(getFeriados(anio + 1)))
  let restante = Math.abs(dias)
  const paso = dias >= 0 ? 1 : -1
  while (restante > 0) {
    dt.setDate(dt.getDate() + paso)
    const dow = dt.getDay()
    const iso = dt.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && !feriados.has(iso)) restante--
  }
  return dt.toISOString().slice(0, 10)
}

function addDias(fechaStr, dias) {
  if (!fechaStr) return ''
  const dt = new Date(fechaStr + 'T00:00:00')
  dt.setDate(dt.getDate() + dias)
  return dt.toISOString().slice(0, 10)
}

// Días hábiles según cantidad: INT(cant / divisor)
function diasHabilesPorCant(cant, divisor) {
  const c = parseInt(cant) || 0
  return Math.max(1, Math.floor(c / divisor))
}

// Calcula fechas para ambas actividades a partir de la fecha de entrega y cantidades
function calcularFechas(fechaEntrega, cantFact, cantInst) {
  if (!fechaEntrega) return { fact: {}, inst: {} }

  const inicioFact = addDias(fechaEntrega, 1)
  const diasFact = diasHabilesPorCant(cantFact, 5)
  const finFact = addDiasHabiles(inicioFact, diasFact)
  const limiteFact = addDiasHabiles(finFact, 1)

  const inicioInst = addDias(fechaEntrega, 1)
  const diasInst = diasHabilesPorCant(cantInst, 10)
  const finInst = addDiasHabiles(inicioInst, diasInst)
  const limiteInst = addDiasHabiles(finInst, 1)

  // Fecha límite compartida = la mayor de ambas
  const limiteComun = limiteFact > limiteInst ? limiteFact : limiteInst

  return {
    fact: { inicio: inicioFact, fin: finFact, limite: limiteFact, plazo: diasFact },
    inst: { inicio: inicioInst, fin: finInst,  limite: limiteInst,  plazo: diasInst },
    limiteComun,
  }
}

const FORM_DEFAULT = {
  numero_ot:      '',
  contratista_id: '',
  contrato:       '',
  fecha_entrega:  '',
  cant_fact:      '',
  cant_inst:      '',
  obs_fact:       '',
  obs_inst:       '',
  fecha_reporte_fact: '',
  fecha_reporte_inst: '',
  cant_ent_fact:  '',
  cant_ent_inst:  '',
}

export default function ModalInstOT({ modulo, contratistas, par, onClose, onSaved }) {
  const esEdicion = !!par
  const [form, setForm] = useState(FORM_DEFAULT)
  const [fechas, setFechas] = useState({ fact: {}, inst: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (esEdicion && par?.length) {
      const fact = par.find(o => o.actividad === 'factibilidades') || par[0]
      const inst = par.find(o => o.actividad === 'instalaciones')
      setForm({
        numero_ot:          String(fact.numero_ot || ''),
        contratista_id:     String(fact.contratista_id || ''),
        contrato:           fact.contrato || '',
        fecha_entrega:      fact.datos_extra?.doc_fecha_entrega || '',
        cant_fact:          String(fact.cantidad_programada || ''),
        cant_inst:          String(inst?.cantidad_programada || ''),
        obs_fact:           fact.observaciones || '',
        obs_inst:           inst?.observaciones || '',
        fecha_reporte_fact: fact.fecha_reporte || '',
        fecha_reporte_inst: inst?.fecha_reporte || '',
        cant_ent_fact:      String(fact.cantidad_entregada || ''),
        cant_ent_inst:      String(inst?.cantidad_entregada || ''),
      })
    }
  }, [par, esEdicion])

  useEffect(() => {
    setFechas(calcularFechas(form.fecha_entrega, form.cant_fact, form.cant_inst))
  }, [form.fecha_entrega, form.cant_fact, form.cant_inst])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function guardar() {
    if (!form.numero_ot) { setError('N° OT es obligatorio'); return }
    if (!form.contratista_id) { setError('Contratista es obligatorio'); return }
    if (!form.fecha_entrega) { setError('Fecha de entrega OT es obligatoria'); return }
    setSaving(true)
    setError('')

    const baseOT = {
      modulo_id:      parseInt(modulo?.id),
      contratista_id: parseInt(form.contratista_id),
      contrato:       form.contrato,
      numero_ot:      parseInt(form.numero_ot) || form.numero_ot,
      periodo:        modulo?.periodo,
      datos_extra:    { doc_fecha_entrega: form.fecha_entrega },
    }

    const otFact = {
      ...baseOT,
      actividad:             'factibilidades',
      cantidad_programada:   parseInt(form.cant_fact) || null,
      fecha_inicio:          fechas.fact?.inicio || null,
      fecha_fin_trabajos:    fechas.fact?.fin || null,
      fecha_limite_expedientes: fechas.fact?.limite || null,
      fecha_reporte:         form.fecha_reporte_fact || null,
      cantidad_entregada:    form.fecha_reporte_fact ? (parseInt(form.cant_ent_fact) || null) : null,
      observaciones:         form.obs_fact || null,
    }

    const otInst = {
      ...baseOT,
      actividad:             'instalaciones',
      cantidad_programada:   parseInt(form.cant_inst) || null,
      fecha_inicio:          fechas.inst?.inicio || null,
      fecha_fin_trabajos:    fechas.inst?.fin || null,
      fecha_limite_expedientes: fechas.inst?.limite || null,
      fecha_reporte:         form.fecha_reporte_inst || null,
      cantidad_entregada:    form.fecha_reporte_inst ? (parseInt(form.cant_ent_inst) || null) : null,
      observaciones:         form.obs_inst || null,
    }

    try {
      if (esEdicion) {
        const factId = par.find(o => o.actividad === 'factibilidades')?.id
        const instId = par.find(o => o.actividad === 'instalaciones')?.id
        if (factId) await supabase.from('ots').update(otFact).eq('id', factId)
        if (instId) await supabase.from('ots').update(otInst).eq('id', instId)
        if (!instId && form.cant_inst) await supabase.from('ots').insert(otInst)
      } else {
        await supabase.from('ots').insert([otFact, ...(form.cant_inst ? [otInst] : [])])
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const fmtD = d => d || '—'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="relative rounded-2xl border border-gray-700 p-6 w-full max-w-2xl overflow-y-auto" style={{ background: '#0f1a2e', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white">
              {esEdicion ? '✏ Editar OT' : '+ Nueva OT'} — Instalaciones Nuevas
            </h2>
            <p className="text-xs text-gray-500 mt-1">{modulo?.nombre} · {modulo?.periodo}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Campos base */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">N° OT <span className="text-cyan-400">*</span></label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
              placeholder="Ej: 152"
              value={form.numero_ot}
              onChange={e => set('numero_ot', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Contratista <span className="text-cyan-400">*</span></label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
              value={form.contratista_id}
              onChange={e => {
                const cont = contratistas.find(c => String(c.id) === e.target.value)
                set('contratista_id', e.target.value)
                if (cont?.contrato) set('contrato', cont.contrato)
              }}
            >
              <option value="">— Seleccionar —</option>
              {contratistas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">N° Contrato</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 text-xs outline-none focus:border-cyan-500"
              placeholder="Ej: 48-2025-ELPU/GG"
              value={form.contrato}
              onChange={e => set('contrato', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fecha entrega OT <span className="text-cyan-400">*</span></label>
            <input
              type="date"
              className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
              value={form.fecha_entrega}
              onChange={e => set('fecha_entrega', e.target.value)}
            />
          </div>
        </div>

        {/* Factibilidades */}
        <div className="rounded-xl border mb-3 overflow-hidden" style={{ borderColor: '#0e7490' }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: '#083344' }}>
            <span className="text-xs font-bold" style={{ color: '#06b6d4' }}>Factibilidades</span>
            <span className="text-xs text-gray-500">· Ítem 1</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3" style={{ background: '#0a1220' }}>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Cantidad programada</label>
              <input type="number" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                placeholder="0" value={form.cant_fact} onChange={e => set('cant_fact', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. inicio (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#5c7a9e', background: '#0f1a2e' }}>{fmtD(fechas.fact?.inicio)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. final (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#5c7a9e', background: '#0f1a2e' }}>{fmtD(fechas.fact?.fin)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. límite (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#06b6d4', background: '#0f1a2e' }}>{fmtD(fechas.fact?.limite)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Plazo</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#06b6d4', background: '#0f1a2e' }}>
                {fechas.fact?.plazo ? `${fechas.fact.plazo} días háb.` : '—'}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. reporte</label>
              <input type="date" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                value={form.fecha_reporte_fact} onChange={e => set('fecha_reporte_fact', e.target.value)} />
            </div>
            {form.fecha_reporte_fact && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Cant. entregada</label>
                <input type="number" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                  placeholder="0" value={form.cant_ent_fact} onChange={e => set('cant_ent_fact', e.target.value)} />
              </div>
            )}
            <div className="col-span-3">
              <label className="text-xs text-gray-400 block mb-1">Observaciones</label>
              <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 text-xs outline-none focus:border-cyan-500"
                placeholder="Opcional..." value={form.obs_fact} onChange={e => set('obs_fact', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Instalaciones Nuevas */}
        <div className="rounded-xl border mb-4 overflow-hidden" style={{ borderColor: '#7c3aed' }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: '#1a0f33' }}>
            <span className="text-xs font-bold" style={{ color: '#c084fc' }}>Instalaciones Nuevas</span>
            <span className="text-xs text-gray-500">· Ítem 2 (opcional)</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3" style={{ background: '#0a1220' }}>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Cantidad programada</label>
              <input type="number" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-purple-500"
                placeholder="0 (dejar vacío si no aplica)" value={form.cant_inst} onChange={e => set('cant_inst', e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. inicio (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#5c7a9e', background: '#0f1a2e' }}>{fmtD(fechas.inst?.inicio)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. final (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#5c7a9e', background: '#0f1a2e' }}>{fmtD(fechas.inst?.fin)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. límite (auto)</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#c084fc', background: '#0f1a2e' }}>{fmtD(fechas.inst?.limite)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Plazo</label>
              <div className="px-3 py-2 rounded-lg border border-gray-800 text-xs" style={{ color: '#c084fc', background: '#0f1a2e' }}>
                {fechas.inst?.plazo ? `${fechas.inst.plazo} días háb.` : '—'}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">F. reporte</label>
              <input type="date" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-purple-500"
                value={form.fecha_reporte_inst} onChange={e => set('fecha_reporte_inst', e.target.value)} />
            </div>
            {form.fecha_reporte_inst && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Cant. entregada</label>
                <input type="number" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-purple-500"
                  placeholder="0" value={form.cant_ent_inst} onChange={e => set('cant_ent_inst', e.target.value)} />
              </div>
            )}
            <div className="col-span-3">
              <label className="text-xs text-gray-400 block mb-1">Observaciones</label>
              <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 text-xs outline-none focus:border-purple-500"
                placeholder="Opcional..." value={form.obs_inst} onChange={e => set('obs_inst', e.target.value)} />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-gray-800 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800 transition-all">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ background: '#06b6d4', color: '#000' }}
          >
            {saving ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear OT'}
          </button>
        </div>
      </div>
    </div>
  )
}
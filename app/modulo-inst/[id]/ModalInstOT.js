'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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

export default function ModalInstOT({ modulo, contratistas, par, onClose, onSaved, anioActivo }) {
  const esEdicion = !!par
  const [form, setForm] = useState(FORM_DEFAULT)
  const [fechas, setFechas] = useState({ fact: {}, inst: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [docOpen, setDocOpen] = useState(true)
  const [otGuardada, setOtGuardada] = useState(null) // { fact, inst }
  const [editadoPor, setEditadoPor] = useState('ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES')
  const [generandoDoc, setGenerandoDoc] = useState(false)

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
      periodo:        anioActivo || String(new Date().getFullYear()),
      datos_extra:    { doc_fecha_entrega: form.fecha_entrega },
    }

    const otFact = {
      ...baseOT,
      actividad:             'factibilidades',
      cantidad_programada:   parseInt(form.cant_fact) || null,
      fecha_inicio:          form.fi_fact_manual || fechas.fact?.inicio || null,
      fecha_fin_trabajos:    form.ff_fact_manual || fechas.fact?.fin || null,
      fecha_limite_expedientes: form.fl_fact_manual || fechas.fact?.limite || null,
      observaciones:         form.obs_fact || null,
    }

    const otInst = {
      ...baseOT,
      actividad:             'instalaciones',
      cantidad_programada:   parseInt(form.cant_inst) || null,
      fecha_inicio:          form.fi_inst_manual || fechas.inst?.inicio || null,
      fecha_fin_trabajos:    form.ff_inst_manual || fechas.inst?.fin || null,
      fecha_limite_expedientes: form.fl_inst_manual || fechas.inst?.limite || null,
      observaciones:         form.obs_inst || null,
    }

    try {
      if (esEdicion) {
        const factId = par.find(o => o.actividad === 'factibilidades')?.id
        const instId = par.find(o => o.actividad === 'instalaciones')?.id
        if (factId) await supabase.from('ots').update(otFact).eq('id', factId)
        if (instId) await supabase.from('ots').update(otInst).eq('id', instId)
        if (!instId && form.cant_inst) await supabase.from('ots').insert(otInst)
        onSaved()
      } else {
        const inserts = [otFact, ...(form.cant_inst ? [otInst] : [])]
        const { data: inserted } = await supabase.from('ots').insert(inserts).select()
        const fact = inserted?.find(o => o.actividad === 'factibilidades')
        const inst = inserted?.find(o => o.actividad === 'instalaciones')
        setOtGuardada({ fact, inst })
        setGuardado(true)
        onSaved(true) // refresca tabla sin cerrar modal
      }
    } catch (e) {
      setError(e.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const fmtD = d => d || '—'

  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const DIAS  = ['do','lu','ma','mi','ju','vi','sá']
  function fmtEntrega(d) { if (!d) return ''; const dt = new Date(d+'T00:00:00'); return `${String(dt.getDate()).padStart(2,'0')}-${MESES[dt.getMonth()]}-${dt.getFullYear()}` }
  function fmtTabla(d) { if (!d) return ''; const dt = new Date(d+'T00:00:00'); return `${DIAS[dt.getDay()]} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` }
  function diasHab(ini, fin) { if (!ini||!fin) return ''; const d1=new Date(ini+'T00:00:00'),d2=new Date(fin+'T00:00:00'); let dias=0,cur=new Date(d1); while(cur<=d2){if(cur.getDay()!==0&&cur.getDay()!==6)dias++;cur.setDate(cur.getDate()+1)} return `${dias} días` }

  async function generarDoc(pdf = false, docFields = {}) {
    const fact = otGuardada?.fact
    const inst = otGuardada?.inst
    if (!fact) return
    const vars = {
      numero_ot:          String(fact.numero_ot || ''),
      contrato:           (fact.contrato || '').replace(/^contrato\s+/i,'').trim(),
      fecha_entrega:      fmtEntrega(fact.datos_extra?.doc_fecha_entrega),
      titulo:             docFields.titulo || 'ÓRDENES DE TRABAJO - INSTALACIONES NUEVAS Y FACTIBILIDAD DE SUMINISTROS',
      editado_por:        docFields.editado_por || 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',
      detalle_fact:       docFields.detalle_fact || 'Adjunto listado OT por correo electrónico',
      detalle_inst:       docFields.detalle_inst || 'Adjunto listado OT por correo electrónico',
      firma_coordinador:  docFields.firma_coordinador || 'COORDINADOR "CONSORCIO SUPERVISOR"',
      firma_area_usuaria: docFields.firma_area_usuaria || 'ÁREA USUARIA - ELECTROPUNO S.A.A.',
      firma_supervisor:   docFields.firma_supervisor || 'SUPERVISOR "Consorcio San Pedro - ITEM 4"',
      fi_fact:      fmtTabla(fact.fecha_inicio),
      ff_fact:      fmtTabla(fact.fecha_fin_trabajos),
      fl_fact:      fmtTabla(fact.fecha_limite_expedientes),
      plazo_fact:   diasHab(fact.fecha_inicio, fact.fecha_fin_trabajos),
      cant_fact:    String(fact.cantidad_programada || ''),
      fi_inst:      fmtTabla(inst?.fecha_inicio),
      ff_inst:      fmtTabla(inst?.fecha_fin_trabajos),
      fl_inst:      fmtTabla(inst?.fecha_limite_expedientes),
      plazo_inst:   diasHab(inst?.fecha_inicio, inst?.fecha_fin_trabajos),
      cant_inst:    String(inst?.cantidad_programada || ''),
    }
    const template = 'template_instalaciones.docx'
    setGenerandoDoc(true)
    try {
      const res = await fetch('/api/genword-inst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, vars, pdf })
      })
      if (!res.ok) { alert('Error: ' + await res.text()); return }
      const blob = new Blob([await res.arrayBuffer()], { type: pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `OT-${vars.numero_ot}_Instalaciones_Nuevas.${pdf ? 'pdf' : 'docx'}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch(e) { alert('Error: ' + e.message) }
    finally { setGenerandoDoc(false) }
  }

  // ── Vista post-guardado ──────────────────────────────────────
  const contNombre = contratistas.find(c => c.id === parseInt(form.contratista_id))?.nombre || ''
  const firmaSupDefault = contNombre.toLowerCase().includes('san pedro')
    ? 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'
    : contNombre ? `SUPERVISOR "${contNombre}"` : 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'

  const [docFields, setDocFields] = useState({
    titulo:            'ÓRDENES DE TRABAJO - INSTALACIONES NUEVAS Y FACTIBILIDAD DE SUMINISTROS',
    editado_por:       'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',
    detalle_fact:      'Adjunto listado OT por correo electrónico',
    detalle_inst:      'Adjunto listado OT por correo electrónico',
    firma_coordinador: 'COORDINADOR "CONSORCIO SUPERVISOR"',
    firma_area_usuaria:'ÁREA USUARIA - ELECTROPUNO S.A.A.',
    firma_supervisor:  firmaSupDefault,
  })
  const setDoc = (k, v) => setDocFields(p => ({ ...p, [k]: v }))

  if (guardado && otGuardada) {
    const fact = otGuardada.fact

    const postContent = (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
        <div className="relative rounded-2xl border border-gray-700 p-6 w-full max-w-xl overflow-y-auto" style={{ background: '#0f1a2e', maxHeight: '90vh' }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-lg">✓</span>
                <h2 className="text-base font-bold text-white">OT-{String(fact?.numero_ot).padStart(2,'0')} creada</h2>
              </div>
              <p className="text-xs text-gray-500 mt-1">¿Deseas generar el documento ahora?</p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
          </div>

          {/* Sección colapsable */}
          <div className="rounded-xl border border-gray-700 overflow-hidden mb-4">
            <button className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-300 hover:bg-gray-800 transition-all"
              style={{ background: '#0a1628' }} onClick={() => setDocOpen(v => !v)}>
              <span>📄 Campos del documento</span>
              <span className="text-gray-500">{docOpen ? '▴' : '▾'}</span>
            </button>
            {docOpen && (
              <div className="p-4 space-y-3" style={{ background: '#080f1e' }}>
                {/* Título */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Título del documento</label>
                  <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={docFields.titulo} onChange={e => setDoc('titulo', e.target.value)} />
                </div>
                {/* Editado por */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Editado por</label>
                  <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={docFields.editado_por} onChange={e => setDoc('editado_por', e.target.value)} />
                </div>
                {/* Detalle Factibilidades */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Detalle — Factibilidades</label>
                  <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={docFields.detalle_fact} onChange={e => setDoc('detalle_fact', e.target.value)} />
                </div>
                {/* Detalle Instalaciones */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Detalle — Instalaciones Nuevas</label>
                  <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={docFields.detalle_inst} onChange={e => setDoc('detalle_inst', e.target.value)} />
                </div>
                {/* Firmas */}
                <div className="pt-2 border-t border-gray-800">
                  <label className="text-xs text-gray-500 block mb-2">Área de firmas</label>
                  <div className="space-y-2">
                    {[
                      { key: 'firma_coordinador', label: 'Coordinador' },
                      { key: 'firma_area_usuaria', label: 'Área Usuaria' },
                      { key: 'firma_supervisor',   label: 'Supervisor' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-xs text-gray-500 block mb-1">{label}</label>
                        <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-200 text-xs outline-none focus:border-cyan-500"
                          value={docFields[key]} onChange={e => setDoc(key, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botones */}
          <div className="flex gap-2">
            <button onClick={() => generarDoc(false, docFields)} disabled={generandoDoc}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-700 text-gray-200 text-xs hover:bg-gray-800 transition-all disabled:opacity-50">
              {generandoDoc ? '⏳...' : '📄 Descargar Word'}
            </button>
            <button onClick={() => generarDoc(true, docFields)} disabled={generandoDoc}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: '#06b6d4', color: '#000' }}>
              {generandoDoc ? '⏳...' : '📋 Descargar PDF'}
            </button>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800">Cerrar</button>
          </div>
        </div>
      </div>
    )
    if (typeof window === 'undefined') return null
    return createPortal(postContent, document.body)
  }

  const modalContent = (
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
        </div>

        {/* Fecha entrega OT — campo protagonista */}
        <div className="rounded-xl p-4 mb-4" style={{ background: '#0a1628', border: '1.5px solid #0e7490' }}>
          <label className="text-xs font-bold block mb-2" style={{ color: '#06b6d4' }}>
            📅 Fecha entrega OT <span className="text-cyan-400">*</span>
            <span className="text-gray-500 font-normal ml-2">— las fechas de inicio y fin se calculan automáticamente</span>
          </label>
          <input
            type="date"
            className="w-full px-4 py-3 rounded-lg border text-white text-sm font-semibold outline-none"
            style={{ borderColor: '#06b6d4', background: '#080f1e', fontSize: '15px' }}
            value={form.fecha_entrega}
            onChange={e => set('fecha_entrega', e.target.value)}
          />
        </div>

        {/* Factibilidades */}
        <div className="rounded-xl border mb-3 overflow-hidden" style={{ borderColor: '#0e7490' }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: '#083344' }}>
            <span className="text-xs font-bold" style={{ color: '#06b6d4' }}>Factibilidades</span>
            <span className="text-xs text-gray-500">· Ítem 1</span>
          </div>
          <div className="p-4" style={{ background: '#0a1220' }}>
            {/* Cantidad — protagonista */}
            <div className="mb-3 p-3 rounded-lg" style={{ background: '#0f1a2e', border: '1px solid #0e7490' }}>
              <label className="text-xs font-semibold block mb-1" style={{ color: '#06b6d4' }}>Cantidad programada</label>
              <input type="text" inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-lg font-bold outline-none focus:border-cyan-500 text-center"
                placeholder="0" value={form.cant_fact} onChange={e => set('cant_fact', e.target.value)} />
            </div>
            {/* Fechas calculadas — editables */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. inicio</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-cyan-500"
                  style={{ color: '#5c7a9e' }}
                  value={fechas.fact?.inicio || form.fi_fact_manual || ''}
                  onChange={e => set('fi_fact_manual', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. final</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-cyan-500"
                  style={{ color: '#5c7a9e' }}
                  value={fechas.fact?.fin || form.ff_fact_manual || ''}
                  onChange={e => set('ff_fact_manual', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. límite</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-cyan-500"
                  style={{ color: '#06b6d4' }}
                  value={fechas.fact?.limite || form.fl_fact_manual || ''}
                  onChange={e => set('fl_fact_manual', e.target.value)} />
              </div>
            </div>
            <div className="mt-2">
              <label className="text-xs text-gray-500 block mb-1">Observaciones</label>
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
          <div className="p-4" style={{ background: '#0a1220' }}>
            {/* Cantidad — protagonista */}
            <div className="mb-3 p-3 rounded-lg" style={{ background: '#0f1a2e', border: '1px solid #7c3aed' }}>
              <label className="text-xs font-semibold block mb-1" style={{ color: '#c084fc' }}>Cantidad programada</label>
              <input type="text" inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-lg font-bold outline-none focus:border-purple-500 text-center"
                placeholder="0 (dejar vacío si no aplica)" value={form.cant_inst} onChange={e => set('cant_inst', e.target.value)} />
            </div>
            {/* Fechas calculadas — editables */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. inicio</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-purple-500"
                  style={{ color: '#5c7a9e' }}
                  value={fechas.inst?.inicio || form.fi_inst_manual || ''}
                  onChange={e => set('fi_inst_manual', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. final</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-purple-500"
                  style={{ color: '#5c7a9e' }}
                  value={fechas.inst?.fin || form.ff_inst_manual || ''}
                  onChange={e => set('ff_inst_manual', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">F. límite</label>
                <input type="date" className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-xs outline-none focus:border-purple-500"
                  style={{ color: '#c084fc' }}
                  value={fechas.inst?.limite || form.fl_inst_manual || ''}
                  onChange={e => set('fl_inst_manual', e.target.value)} />
              </div>
            </div>
            <div className="mt-2">
              <label className="text-xs text-gray-500 block mb-1">Observaciones</label>
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

  if (typeof window === 'undefined') return null
  return createPortal(modalContent, document.body)
}
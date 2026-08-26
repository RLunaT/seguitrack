'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'

// Feriados exactos del Excel (columnas L y M — nacionales y locales Puno)
// Se sobreescriben con los valores de la BD si se pasan como prop
const FERIADOS_DEFAULT = new Set([
  '2026-01-01','2026-04-02','2026-04-03','2026-05-01','2026-06-07',
  '2026-06-29','2026-07-23','2026-07-28','2026-07-29','2026-08-06',
  '2026-08-30','2026-11-01','2026-12-08','2026-12-09','2026-12-25',
  '2025-01-01','2025-04-17','2025-04-18','2025-05-01','2025-06-29',
  '2025-07-28','2025-07-29','2025-08-30','2025-11-01','2025-12-08','2025-12-25',
])
// calcularPlazo: días calendario (fin - inicio) + 1
function calcularPlazo(ini, fin) {
  if (!ini || !fin) return null
  const d1 = new Date(ini + 'T00:00:00')
  const d2 = new Date(fin + 'T00:00:00')
  return Math.round((d2 - d1) / 86400000) + 1
}

// Réplica exacta de las fórmulas del Excel
function calcularFechas(fechaEntrega, cantFact, cantInst, capFact = 20, capInst = 25, feriadosSet = FERIADOS_DEFAULT) {
  if (!fechaEntrega) return { fact: {}, inst: {} }

  function esFeriado(fecha) {
    const iso = typeof fecha === 'string' ? fecha : fecha.toISOString().slice(0,10)
    return feriadosSet.has(iso)
  }
  function workdayIntl11(fechaStr, n) {
    if (!fechaStr || n <= 0) return fechaStr
    const dt = new Date(fechaStr + 'T00:00:00')
    let restante = n
    while (restante > 0) {
      dt.setDate(dt.getDate() + 1)
      if (dt.getDay() !== 0 && !esFeriado(dt)) restante--
    }
    return dt.toISOString().slice(0,10)
  }
  function workday(fechaStr, n) {
    if (!fechaStr) return fechaStr
    const dt = new Date(fechaStr + 'T00:00:00')
    let restante = Math.abs(n)
    const paso = n >= 0 ? 1 : -1
    while (restante > 0) {
      dt.setDate(dt.getDate() + paso)
      if (dt.getDay() !== 0 && dt.getDay() !== 6 && !esFeriado(dt)) restante--
    }
    return dt.toISOString().slice(0,10)
  }

  // C11 = I7 + 1 (día calendario)
  const dtEntrega = new Date(fechaEntrega + 'T00:00:00')
  dtEntrega.setDate(dtEntrega.getDate() + 1)
  const inicio = dtEntrega.toISOString().slice(0,10)

  // Factibilidades
  // D11 = WORKDAY.INTL(C11, INT(G11/20), 11, feriados)
  const nFact = Math.floor((parseInt(cantFact) || 0) / capFact)
  const finFact = nFact > 0 ? workdayIntl11(inicio, nFact) : inicio

  // E11 = WORKDAY(D11, IF(WEEKDAY(D11,2)=6, 2, 1), feriados_locales)
  const dtFinFact = new Date(finFact + 'T00:00:00')
  const dowFact = dtFinFact.getDay() // 6=sáb
  const diasLimiteFact = dowFact === 6 ? 2 : 1
  const limiteFact = workday(finFact, diasLimiteFact)

  // Instalaciones Nuevas
  // C12 = C11, D12 = WORKDAY.INTL(C12, INT(G12/25), 11, feriados)
  const nInst = Math.floor((parseInt(cantInst) || 0) / capInst)
  const finInst = nInst > 0 ? workdayIntl11(inicio, nInst) : inicio

  // E12 = WORKDAY(D12, IF(WEEKDAY(D12,2)=6, 2, 1), feriados_locales) — sin +3
  const dtFinInst = new Date(finInst + 'T00:00:00')
  const dowInst = dtFinInst.getDay()
  const diasLimiteInst = dowInst === 6 ? 2 : 1
  const limiteInst = workday(finInst, diasLimiteInst)

  return {
    fact: {
      inicio,
      fin:    finFact,
      limite: limiteFact,
      plazo:  calcularPlazo(inicio, finFact),
    },
    inst: {
      inicio,
      fin:    finInst,
      limite: limiteInst,
      plazo:  calcularPlazo(inicio, finInst),
    },
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

// Días abreviados en español
const DIAS_ES = ['do','lu','ma','mi','ju','vi','sá']
function fmtFechaModal(iso) {
  if (!iso) return '—'
  const dt = new Date(iso + 'T00:00:00')
  const dia = DIAS_ES[dt.getDay()]
  return `${dia} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}

export default function ModalInstOT({ modulo, contratistas, par, onClose, onSaved, anioActivo, capacidades, feriadosDB, onDocStatus }) {
  const esEdicion = !!par
  const [form, setForm] = useState(FORM_DEFAULT)
  const [fechas, setFechas] = useState({ fact: {}, inst: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [docOpen, setDocOpen] = useState(false)
  const [otGuardada, setOtGuardada] = useState(null)
  const [editadoPor, setEditadoPor] = useState('ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES')
  const [generandoDoc, setGenerandoDoc] = useState(false)
  const [docStatus, setDocStatus] = useState(null) // null | 'word-gen' | 'word-ok' | 'pdf-gen' | 'pdf-ok' | 'error'

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
    const feriadosSet = feriadosDB?.length
      ? new Set(feriadosDB.map(f => f.fecha))
      : FERIADOS_DEFAULT
    const capFact = capacidades?.fact || 20
    const capInst = capacidades?.inst || 25
    setFechas(calcularFechas(form.fecha_entrega, form.cant_fact, form.cant_inst, capFact, capInst, feriadosSet))
  }, [form.fecha_entrega, form.cant_fact, form.cant_inst, capacidades, feriadosDB])

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
  function diasHab(ini, fin) { if (!ini||!fin) return ''; const d1=new Date(ini+'T00:00:00'),d2=new Date(fin+'T00:00:00'); return `${Math.round((d2-d1)/86400000)+1} días` }

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
    setDocStatus(pdf ? 'pdf-gen' : 'word-gen')
    onDocStatus?.(pdf ? 'pdf-gen' : 'word-gen')
    try {
      const res = await fetch('/api/genword-inst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, vars, pdf })
      })
      if (!res.ok) { setDocStatus('error'); onDocStatus?.('error'); alert('Error: ' + await res.text()); return }
      const blob = new Blob([await res.arrayBuffer()], { type: pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `OT-${vars.numero_ot}_Instalaciones_Nuevas.${pdf ? 'pdf' : 'docx'}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      const okStatus = pdf ? 'pdf-ok' : 'word-ok'
      setDocStatus(okStatus)
      onDocStatus?.(okStatus)
    } catch(e) { setDocStatus('error'); onDocStatus?.('error'); alert('Error: ' + e.message) }
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
              <span>✏️ ¿Deseas editar campos del documento?</span>
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
              📄 Descargar Word
            </button>
            <button onClick={() => generarDoc(true, docFields)} disabled={generandoDoc}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: '#06b6d4', color: '#000' }}>
              📋 Descargar PDF
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

        {/* Campos base — una sola fila */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">N° OT <span className="text-cyan-400">*</span></label>
            <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
              placeholder="Ej: 152" value={form.numero_ot} onChange={e => set('numero_ot', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Contratista <span className="text-cyan-400">*</span></label>
            <select className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
              value={form.contratista_id}
              onChange={e => { const cont = contratistas.find(c => String(c.id) === e.target.value); set('contratista_id', e.target.value); if (cont?.contrato) set('contrato', cont.contrato) }}>
              <option value="">— Seleccionar —</option>
              {contratistas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">N° Contrato</label>
            <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 text-xs outline-none focus:border-cyan-500"
              placeholder="Ej: 48-2025-ELPU/GG" value={form.contrato} onChange={e => set('contrato', e.target.value)} />
          </div>
        </div>

        {/* Fecha entrega OT — protagonista */}
        <div className="rounded-xl p-4 mb-4" style={{ background: '#0a1628', border: '1.5px solid #0e7490' }}>
          <label className="text-xs font-bold block mb-2" style={{ color: '#06b6d4' }}>
            🗓️ Fecha entrega OT <span className="text-cyan-400">*</span>
            <span className="text-gray-500 font-normal ml-2">— las fechas se calculan automáticamente y son editables</span>
          </label>
          <div className="relative">
            <div className="w-full px-4 py-3 pr-10 rounded-lg border font-semibold cursor-pointer"
              style={{ borderColor: '#06b6d4', background: '#080f1e', fontSize: '15px', color: form.fecha_entrega ? '#ffffff' : '#4b6a8a' }}
              onClick={() => { const el = document.getElementById('inp-fecha-entrega'); el?.showPicker ? el.showPicker() : el?.click() }}>
              {form.fecha_entrega ? fmtFechaModal(form.fecha_entrega) : 'Seleccionar fecha...'}
            </div>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base" style={{ color: '#06b6d4', pointerEvents: 'none' }}>🗓️</span>
            <input id="inp-fecha-entrega" type="date"
              style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
              value={form.fecha_entrega} onChange={e => set('fecha_entrega', e.target.value)} />
          </div>
        </div>

        {/* Factibilidades + Instalaciones Nuevas — horizontales */}
        <div className="grid grid-cols-2 gap-3 mb-4">

          {/* Factibilidades */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#0e7490' }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#083344', borderBottom: '0.5px solid #0e7490' }}>
              <span className="text-xs font-bold" style={{ color: '#06b6d4' }}>Factibilidades</span>
              <span className="text-xs text-gray-500">· Ítem 1</span>
            </div>
            <div className="p-3" style={{ background: '#0a1220' }}>
              <div className="mb-3">
                <label className="text-xs text-gray-400 block mb-1">Cantidad programada</label>
                <input type="text" inputMode="numeric"
                  className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-base font-bold outline-none focus:border-cyan-500 text-center"
                  placeholder="0" value={form.cant_fact} onChange={e => set('cant_fact', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {[
                  { label:'F. inicio', field:'fi_fact_manual', fallback: fechas.fact?.inicio, color:'#5c7a9e', id:'inp-fi-fact', bold: false },
                  { label:'F. final',  field:'ff_fact_manual', fallback: fechas.fact?.fin,    color:'#5c7a9e', id:'inp-ff-fact', bold: false },
                  { label:'F. límite', field:'fl_fact_manual', fallback: fechas.fact?.limite, color:'#06b6d4', id:'inp-fl-fact', bold: true  },
                ].map(({label, field, fallback, color, id, bold}) => (
                  <div key={field}>
                    <label className="text-xs text-gray-500 block mb-1">{label}</label>
                    <div className="relative">
                      <div className={`px-2 py-1.5 pr-6 rounded-lg border border-gray-800 bg-gray-900 text-xs font-mono cursor-pointer${bold ? ' font-semibold' : ''}`}
                        style={{ color }} onClick={() => { const el = document.getElementById(id); el?.showPicker ? el.showPicker() : el?.click() }}>
                        {fmtFechaModal(form[field] || fallback)}
                      </div>
                      <span style={{ position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', fontSize:9, opacity:0.5, pointerEvents:'none' }}>✏️</span>
                      <input id={id} type="date" style={{ position:'absolute', opacity:0, width:1, height:1, pointerEvents:'none' }}
                        value={form[field] || fallback || ''} onChange={e => set(field, e.target.value)} />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Plazo</label>
                  <div className="px-2 py-1.5 rounded-lg border border-gray-800 text-xs text-center" style={{ color: '#06b6d4', background: '#0f1a2e' }}>
                    {fechas.fact?.plazo ? `${fechas.fact.plazo} días háb.` : '—'}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Observaciones</label>
                <input className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-gray-300 text-xs outline-none focus:border-cyan-500"
                  placeholder="Opcional..." value={form.obs_fact} onChange={e => set('obs_fact', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Instalaciones Nuevas */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#7c3aed' }}>
            <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#1a0f33', borderBottom: '0.5px solid #7c3aed' }}>
              <span className="text-xs font-bold" style={{ color: '#c084fc' }}>Inst. Nuevas</span>
              <span className="text-xs text-gray-500">· Ítem 2 (opcional)</span>
            </div>
            <div className="p-3" style={{ background: '#0a1220' }}>
              <div className="mb-3">
                <label className="text-xs text-gray-400 block mb-1">Cantidad programada</label>
                <input type="text" inputMode="numeric"
                  className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-base font-bold outline-none focus:border-purple-500 text-center"
                  placeholder="0" value={form.cant_inst} onChange={e => set('cant_inst', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {[
                  { label:'F. inicio', field:'fi_inst_manual', fallback: fechas.inst?.inicio, color:'#5c7a9e', id:'inp-fi-inst', bold: false },
                  { label:'F. final',  field:'ff_inst_manual', fallback: fechas.inst?.fin,    color:'#5c7a9e', id:'inp-ff-inst', bold: false },
                  { label:'F. límite', field:'fl_inst_manual', fallback: fechas.inst?.limite, color:'#c084fc', id:'inp-fl-inst', bold: true  },
                ].map(({label, field, fallback, color, id, bold}) => (
                  <div key={field}>
                    <label className="text-xs text-gray-500 block mb-1">{label}</label>
                    <div className="relative">
                      <div className={`px-2 py-1.5 pr-6 rounded-lg border border-gray-800 bg-gray-900 text-xs font-mono cursor-pointer${bold ? ' font-semibold' : ''}`}
                        style={{ color }} onClick={() => { const el = document.getElementById(id); el?.showPicker ? el.showPicker() : el?.click() }}>
                        {fmtFechaModal(form[field] || fallback)}
                      </div>
                      <span style={{ position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', fontSize:9, opacity:0.5, pointerEvents:'none' }}>✏️</span>
                      <input id={id} type="date" style={{ position:'absolute', opacity:0, width:1, height:1, pointerEvents:'none' }}
                        value={form[field] || fallback || ''} onChange={e => set(field, e.target.value)} />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Plazo</label>
                  <div className="px-2 py-1.5 rounded-lg border border-gray-800 text-xs text-center" style={{ color: '#c084fc', background: '#0f1a2e' }}>
                    {fechas.inst?.plazo ? `${fechas.inst.plazo} días háb.` : '—'}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Observaciones</label>
                <input className="w-full px-2 py-1.5 rounded-lg border border-gray-800 bg-gray-900 text-gray-300 text-xs outline-none focus:border-purple-500"
                  placeholder="Opcional..." value={form.obs_inst} onChange={e => set('obs_inst', e.target.value)} />
              </div>
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
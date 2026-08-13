'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { calcularCamposOT, calcularCamposConEficiencia, generarSemanas, getNombreOT, fmtMoneda, getEficienciaLabel, generarCodigoOT } from '@/lib/formulas'

const OFFSETS = {
  1: { inicio: 3, fin: 6,  limite: 3 },
  2: { inicio: 1, fin: 5,  limite: 6 },
  3: { inicio: 5, fin: 5,  limite: 4 },
}

function StepIndicator({ step, total, labels }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {labels.map((l, i) => {
        const n    = i + 1
        const done = n < step
        const curr = n === step
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: done ? '#22c55e' : curr ? '#3b82f6' : '#1f2937',
                  color:      done ? '#fff'    : curr ? '#fff'    : '#4b5563',
                  border:     curr ? '2px solid #60a5fa' : 'none',
                }}>
                {done ? '✓' : n}
              </div>
              <span className="text-xs whitespace-nowrap" style={{color: curr ? '#93c5fd' : done ? '#4ade80' : '#4b5563'}}>
                {l}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-px mx-2 mb-4" style={{background: done ? '#22c55e' : '#1f2937'}}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ModalOT({ modulo, contratistas, camposExtra, actividades, motivos, periodo, ot, onClose, onSave, colsVisibles = {}, totalRegistros = 0 }) {
  const esEdicion    = !!ot
  const esOT         = modulo?.tipo === 'ot'
  const tieneOffsets = !!OFFSETS[modulo?.id]
  const tienePlantilla = !!modulo?.plantilla_titulo && esOT
  const año          = parseInt(periodo?.split('-')[0]) || new Date().getFullYear()
  const semanas      = generarSemanas(año)

  // Pasos: 1=Identificación, 2=Fechas, 3=Documento (si aplica)
  // Al editar: un solo formulario completo con secciones
  const PASOS_NUEVO = [
    '1. Identificación',
    '2. Fechas',
    ...(tienePlantilla ? ['3. Documento'] : []),
  ]

  const [step, setStep]     = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [guardado, setGuardado] = useState(null)

  // Rastrea si el valor actual de doc_codigo_ot fue puesto automáticamente
  // (por nosotros) o escrito/editado a mano por el usuario. Mientras coincida
  // con el último valor que generamos, lo seguimos regenerando al cambiar la
  // semana; en cuanto el usuario lo edita a algo distinto, dejamos de tocarlo.
  const codigoAutoRef = useRef(null)

  const [form, setForm] = useState({
    modulo_id:                modulo.id,
    numero_registro:          '',
    numero_ot:                '',
    contratista_id:           '',
    actividad:                actividades[0] || '',
    motivo_ot:                motivos[0] || '',
    semana:                   '',
    cantidad_programada:      '',
    fecha_inicio:             '',
    fecha_fin_trabajos:       '',
    fecha_limite_expedientes: '',
    fecha_reporte:            '',
    cantidad_entregada:       '',
    val_penalidades_manual:   '',
    observaciones:            '',
    datos_extra:              {},
  })

  const [preview, setPreview] = useState(null)

  // Los campos de "Documento Word" mostraban el texto del módulo solo como
  // placeholder (gris) cuando datos_extra estaba vacío. Eso hacía que el
  // usuario creyera que ese texto ya estaba ahí y lo podía editar, pero el
  // value real era '' — al escribir, el campo pasaba a tener únicamente lo
  // tipeado. Acá precargamos esos defaults como valor real y editable.
  function conDefaultsDocExtra(datos_extra, contratistaId) {
    if (!tienePlantilla) return datos_extra || {}
    const de  = { ...(datos_extra || {}) }
    const cId = contratistaId != null ? parseInt(contratistaId) : null
    const cnt = contratistas.find(c => c.id === cId)
    const defaults = {
      doc_titulo:             modulo?.plantilla_titulo || '',
      doc_cumplimiento:       modulo?.plantilla_cumplimiento || '',
      doc_actividad:          modulo?.plantilla_actividad || '',
      doc_editado_por:        modulo?.plantilla_editado_por || '',
      doc_coordinador:        'CONSORCIO SUPERVISOR',
      doc_area_usuaria:       'ELECTROPUNO S.A.A',
      doc_contratista_firma:  cnt?.nombre || '',
    }
    for (const k in defaults) {
      if (de[k] === undefined || de[k] === null || de[k] === '') {
        if (defaults[k]) de[k] = defaults[k]
      }
    }
    return de
  }

  // Igual que conDefaultsDocExtra, pero para "Código OT": si el campo está
  // vacío, lo llenamos con el código autogenerado como valor real (editable),
  // en vez de dejarlo solo como placeholder. Guardamos ese valor en
  // codigoAutoRef para poder seguir regenerándolo mientras el usuario no lo
  // edite a mano.
  function conCodigoOTSemilla(de, semana) {
    if (!tienePlantilla) return de
    if (de.doc_codigo_ot) { codigoAutoRef.current = null; return de }
    const auto = generarCodigoOT(semana, periodo) || ''
    if (!auto) return de
    codigoAutoRef.current = auto
    return { ...de, doc_codigo_ot: auto }
  }

  useEffect(() => {
    setGuardado(null)
    setStep(1)
    setError('')
    if (ot) {
      const semanaOt = ot.semana || ''
      setForm({
        modulo_id:                modulo.id,
        numero_registro:          ot.numero_registro || '',
        numero_ot:                ot.numero_ot || '',
        contratista_id:           ot.contratista_id || '',
        actividad:                ot.actividad || actividades[0] || '',
        motivo_ot:                ot.motivo_ot || motivos[0] || '',
        semana:                   semanaOt,
        cantidad_programada:      ot.cantidad_programada || '',
        fecha_inicio:             ot.fecha_inicio || '',
        fecha_fin_trabajos:       ot.fecha_fin_trabajos || '',
        fecha_limite_expedientes: ot.fecha_limite_expedientes || '',
        fecha_reporte:            ot.fecha_reporte || '',
        cantidad_entregada:       ot.cantidad_entregada ?? '',
        val_penalidades_manual:   ot.val_penalidades_manual || '',
        observaciones:            ot.observaciones || '',
        datos_extra:              conCodigoOTSemilla(conDefaultsDocExtra(ot.datos_extra, ot.contratista_id), semanaOt),
      })
    } else {
      setForm(prev => {
        const de = conDefaultsDocExtra(prev.datos_extra, prev.contratista_id)
        return { ...prev, numero_registro: String(totalRegistros + 1), datos_extra: conCodigoOTSemilla(de, prev.semana) }
      })
    }
  }, [ot])

  useEffect(() => {
    const cont = contratistas.find(c => c.id === parseInt(form.contratista_id))
    if (!form.fecha_inicio && !form.fecha_limite_expedientes) { setPreview(null); return }
    const calc = calcularCamposConEficiencia({ ...form, contratista_id: parseInt(form.contratista_id) }, cont, periodo, modulo?.id)
    setPreview(calc)
  }, [form.fecha_inicio, form.fecha_limite_expedientes, form.fecha_reporte,
      form.contratista_id, form.val_penalidades_manual, form.cantidad_programada, form.cantidad_entregada])

  // Helper: sumar días a una fecha string
  function addDays(dateStr, n) {
    const r = new Date(dateStr + 'T00:00:00')
    r.setDate(r.getDate() + n)
    return r.toISOString().slice(0, 10)
  }

  // Helper: calcular semana desde fecha_inicio
  function calcSemana(fechaInicio) {
    if (!fechaInicio) return ''
    const dt = new Date(fechaInicio + 'T00:00:00')
    const sy = generarSemanas(parseInt(periodo?.split('-')[0]) || new Date().getFullYear())
    const f  = sy.find(s => {
      const a = new Date(s.inicio); a.setHours(0,0,0,0)
      const b = new Date(s.fin);   b.setHours(23,59,59,999)
      return dt >= a && dt <= b
    })
    return f?.label || ''
  }

  function setField(key, val) {
    setForm(prev => {
      const u    = { ...prev, [key]: val }
      const off  = OFFSETS[modulo?.id]

      // Cadena automática: cuando cambia una fecha, recalcula las posteriores
      if (off) {
        if (key === 'fecha_inicio' && val) {
          u.fecha_fin_trabajos       = addDays(val, off.fin)
          u.fecha_limite_expedientes = addDays(addDays(val, off.fin), off.limite)
        }
        if (key === 'fecha_fin_trabajos' && val) {
          u.fecha_limite_expedientes = addDays(val, off.limite)
        }
      }

      // Semana siempre desde fecha_inicio
      if (key === 'fecha_inicio' && val) {
        u.semana = calcSemana(val)
      }

      // Si la semana cambia (directo por el selector, o indirecto por fecha_inicio),
      // el código OT se vuelve a generar — pero solo si el usuario no lo
      // editó a mano (si lo editó, lo respetamos y no lo tocamos).
      if (key === 'semana' || (key === 'fecha_inicio' && val && u.semana !== prev.semana)) {
        const actual = u.datos_extra?.doc_codigo_ot || ''
        if (!actual || actual === codigoAutoRef.current) {
          const nuevoCodigo = generarCodigoOT(u.semana, periodo) || ''
          codigoAutoRef.current = nuevoCodigo
          u.datos_extra = { ...u.datos_extra, doc_codigo_ot: nuevoCodigo }
        }
      }

      // Al elegir contratista, si el campo "Firma 3 — Contratista" aún está
      // vacío, se precarga con el nombre real (editable), no solo como placeholder.
      if (key === 'contratista_id' && val && tienePlantilla && !u.datos_extra?.doc_contratista_firma) {
        const cnt = contratistas.find(c => c.id === parseInt(val))
        if (cnt?.nombre) {
          u.datos_extra = { ...u.datos_extra, doc_contratista_firma: cnt.nombre }
        }
      }

      return u
    })
  }

  function setExtra(key, val) {
    setForm(prev => {
      const de = { ...prev.datos_extra, [key]: val }
      const u  = { ...prev, datos_extra: de }
      // El usuario está editando el código a mano: dejamos de regenerarlo
      // automáticamente cuando cambie la semana, salvo que coincida por
      // casualidad con el último valor que generamos nosotros.
      if (key === 'doc_codigo_ot' && val !== codigoAutoRef.current) {
        codigoAutoRef.current = null
      }
      if (key === 'doc_fecha_entrega' && val && OFFSETS[modulo?.id]) {
        const off    = OFFSETS[modulo.id]
        // Cadena encadenada: Entrega → Inicio → Fin → Límite
        const fInicio = addDays(val,     off.inicio)
        const fFin    = addDays(fInicio, off.fin)
        const fLimite = addDays(fFin,    off.limite)
        u.fecha_inicio             = fInicio
        u.fecha_fin_trabajos       = fFin
        u.fecha_limite_expedientes = fLimite
        const semanaNueva = calcSemana(fInicio)
        u.semana = semanaNueva
        // Misma razón que arriba: si la semana cambió por esta cadena de fechas,
        // el código OT se regenera salvo que el usuario lo haya editado a mano.
        if (semanaNueva !== prev.semana) {
          const actual = de.doc_codigo_ot || ''
          if (!actual || actual === codigoAutoRef.current) {
            const nuevoCodigo = generarCodigoOT(semanaNueva, periodo) || ''
            codigoAutoRef.current = nuevoCodigo
            u.datos_extra = { ...de, doc_codigo_ot: nuevoCodigo }
          }
        }
      }
      return u
    })
  }

  async function guardar() {
    if (!form.fecha_limite_expedientes) { setError('La fecha límite es requerida.'); return }
    setError(''); setSaving(true)
    const cont    = contratistas.find(c => c.id === parseInt(form.contratista_id))
    const calc    = calcularCamposOT({ ...form, contratista_id: parseInt(form.contratista_id) }, cont, periodo)
    const nr      = form.numero_registro || String(totalRegistros + 1)
    const numero_ot = esOT ? (form.numero_ot || nr) : null

    const payload = {
      modulo_id:                form.modulo_id,
      numero_registro:          nr,
      numero_ot,
      contratista_id:           esOT && form.contratista_id ? parseInt(form.contratista_id) : null,
      actividad:                form.actividad || null,
      motivo_ot:                esOT ? (form.motivo_ot || null) : null,
      semana:                   form.semana || null,
      cantidad_programada:      form.cantidad_programada ? parseInt(form.cantidad_programada) : null,
      fecha_inicio:             form.fecha_inicio || null,
      fecha_fin_trabajos:       form.fecha_fin_trabajos || null,
      fecha_limite_expedientes: form.fecha_limite_expedientes || null,
      fecha_reporte:            form.fecha_reporte || null,
      cantidad_entregada:       form.cantidad_entregada !== '' && form.cantidad_entregada !== null ? parseInt(form.cantidad_entregada) : null,
      val_penalidades_manual:   form.val_penalidades_manual ? parseFloat(form.val_penalidades_manual) : 0,
      observaciones:            form.observaciones || null,
      datos_extra:              form.datos_extra || {},
      contrato:                 calc.contrato,
      nombre_ot:                esOT ? calc.nombre_ot : null,
      progreso:                 calc.progreso,
      dias_plazo:               calc.dias_plazo,
      estado:                   calc.estado,
      duracion_real:            calc.duracion_real,
      dias_fuera_plazo:         calc.dias_fuera_plazo,
      val_total_penalidad:      calc.val_total_penalidad,
      periodo:                  periodo || null,
      actualizado_en:           new Date().toISOString(),
    }

    let err
    if (esEdicion) {
      const res = await supabase.from('ots').update(payload).eq('id', ot.id)
      err = res.error
    } else {
      const res = await supabase.from('ots').insert(payload)
      err = res.error
    }
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    setGuardado({ payload, cont, numero_ot, nr })
    onSave()
  }

  async function descargarWord() {
    if (!guardado) return
    const { payload, cont } = guardado
    const hoy = new Date().toISOString().slice(0, 10)
    const de  = payload.datos_extra || {}

    function fmtEntrega(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return String(dt.getDate()).padStart(2,'0') + '-' + M[dt.getMonth()] + '-' + dt.getFullYear()
}
    function fmtDia(d) {
      if (!d) return ''
      const dt = new Date(d + 'T00:00:00')
      const D = ['dom','lun','mar','mié','jue','vie','sáb']
      return D[dt.getDay()] + ' ' + String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear()
    }
    function limpiarContrato(c) {
      if (!c) return ''
      return c.replace(/^contrato\s+/i, '').trim()
    }

    const data = {
      numero_ot:          String(payload.numero_ot || payload.nr || ''),
      codigo_ot:          String(de.doc_codigo_ot || generarCodigoOT(payload.semana, periodo) || ''),
      contrato:           limpiarContrato(cont?.contrato || ''),
      fecha_entrega:      fmtEntrega(de.doc_fecha_entrega || hoy),
      fecha_inicio:       fmtDia(payload.fecha_inicio),
      fecha_fin:          fmtDia(payload.fecha_fin_trabajos),
      fecha_limite:       fmtDia(payload.fecha_limite_expedientes),
      // Plazo de ejecución para el documento: siempre inicia en 1 por defecto
      // (no el cálculo real de dias_plazo, que puede ser 12+ días según las
      // fechas) — el usuario puede editarlo manualmente con doc_dias_plazo.
      dias_plazo:         String(de.doc_dias_plazo || '1'),
      cantidad:           String(payload.cantidad_programada || ''),
      actividad_doc:      de.doc_actividad    || modulo?.plantilla_actividad || payload.actividad || '',
      actividad_label:    de.doc_actividad    || modulo?.plantilla_actividad || payload.actividad || '',
      editado_por:        de.doc_editado_por  || modulo?.plantilla_editado_por || '',
      cumplimiento:       de.doc_cumplimiento || modulo?.plantilla_cumplimiento || '',
      titulo:             de.doc_titulo       || modulo?.plantilla_titulo || '',
      coordinador:        de.doc_coordinador       || 'CONSORCIO SUPERVISOR',
      area_usuaria:       de.doc_area_usuaria      || 'ELECTROPUNO S.A.A',
      contratista_nombre: de.doc_contratista_firma || cont?.nombre || '',
      firma4:             de.doc_firma4 || '',
      semana:             payload.semana || '',
      periodo:            periodo || '',
      motivo_extra:       payload.motivo_ot || '',
    }
    try {
      const res  = await fetch('/api/genword', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modulo_id: form.modulo_id, actividad: payload.actividad, data }) })
      if (!res.ok) { alert('Error al generar Word'); return }
      const blob = await res.blob()

      // Extrae el nombre real del archivo desde el header que envía la API.
      // window.open() ignora el Content-Disposition y el navegador asigna
      // un nombre aleatorio (UUID) — forzar la descarga con <a download> sí
      // respeta el nombre correcto.
      const disposition = res.headers.get('Content-Disposition') || ''
      // Prioriza filename* (UTF-8, con tildes/símbolos correctos) sobre el
      // filename="" ASCII de respaldo — el regex anterior leía el ASCII
      // primero porque aparece antes en el header, perdiendo tildes y "°".
      const mUtf8 = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = mUtf8 ? decodeURIComponent(mUtf8[1]) : (match ? match[1] : `OT_${data.ot}_${payload.actividad}.docx`)

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch(e) { alert('Error: ' + e.message) }
  }

  // Genera y descarga el PDF — misma data de origen y mismo manejo de
  // nombre de archivo que descargarWord.
  async function descargarPdf() {
    if (!guardado) return
    const { payload, cont } = guardado
    const hoy = new Date().toISOString().slice(0, 10)
    const de  = payload.datos_extra || {}

   function fmtEntrega(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return String(dt.getDate()).padStart(2,'0') + '-' + M[dt.getMonth()] + '-' + dt.getFullYear()
}
    function fmtDia(d) {
      if (!d) return ''
      const dt = new Date(d + 'T00:00:00')
      const D = ['dom','lun','mar','mié','jue','vie','sáb']
      return D[dt.getDay()] + ' ' + String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear()
    }
    function limpiarContrato(c) {
      if (!c) return ''
      return c.replace(/^contrato\s+/i, '').trim()
    }

    const data = {
      numero_ot:          String(payload.numero_ot || payload.nr || ''),
      codigo_ot:          String(de.doc_codigo_ot || generarCodigoOT(payload.semana, periodo) || ''),
      contrato:           limpiarContrato(cont?.contrato || ''),
      fecha_entrega:      fmtEntrega(de.doc_fecha_entrega || hoy),
      fecha_inicio:       fmtDia(payload.fecha_inicio),
      fecha_fin:          fmtDia(payload.fecha_fin_trabajos),
      fecha_limite:       fmtDia(payload.fecha_limite_expedientes),
      dias_plazo:         String(de.doc_dias_plazo || '1'),
      cantidad:           String(payload.cantidad_programada || ''),
      actividad_doc:      de.doc_actividad    || modulo?.plantilla_actividad || payload.actividad || '',
      actividad_label:    de.doc_actividad    || modulo?.plantilla_actividad || payload.actividad || '',
      editado_por:        de.doc_editado_por  || modulo?.plantilla_editado_por || '',
      cumplimiento:       de.doc_cumplimiento || modulo?.plantilla_cumplimiento || '',
      titulo:             de.doc_titulo       || modulo?.plantilla_titulo || '',
      coordinador:        de.doc_coordinador       || 'CONSORCIO SUPERVISOR',
      area_usuaria:       de.doc_area_usuaria      || 'ELECTROPUNO S.A.A',
      contratista_nombre: de.doc_contratista_firma || cont?.nombre || '',
      firma4:             de.doc_firma4 || '',
      semana:             payload.semana || '',
      periodo:            periodo || '',
      motivo_extra:       payload.motivo_ot || '',
    }
    try {
      const res = await fetch('/api/genpdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modulo_id: form.modulo_id, actividad: payload.actividad, data }) })
      if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Error: ' + (e.error || res.statusText)); return }
      const arrayBuffer = await res.arrayBuffer()
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' })

      const disposition = res.headers.get('Content-Disposition') || ''
      const mUtf8 = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = mUtf8 ? decodeURIComponent(mUtf8[1]) : (match ? match[1] : `OT_${data.ot}_${payload.actividad}.pdf`)

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch(e) { alert('Error: ' + e.message) }
  }

  const cont = contratistas.find(c => c.id === parseInt(form.contratista_id))
  const totalPasos = tienePlantilla ? 3 : 2

  // ── RENDER ──────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ maxWidth: esEdicion ? 680 : 600 }}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="text-base font-bold text-white">
              {esEdicion
                ? `✏️ Editar ${esOT ? `OT #${ot.numero_ot||ot.numero_registro}` : `Reg. #${ot.numero_registro}`}`
                : `+ Nuevo ${esOT ? 'registro de OT' : 'registro'}`}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{modulo.icono} {modulo.nombre} · {periodo}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800">✕</button>
        </div>

        <div className="px-6 pt-5 pb-6">

          {/* ══ MODO CREAR — wizard por pasos ══ */}
          {!esEdicion && (
            <>
              <StepIndicator step={step} total={totalPasos} labels={PASOS_NUEVO}/>

              {/* ── PASO 1: Identificación ── */}
              {step === 1 && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-4">Ingresa los datos principales de la OT. Solo toma un momento.</p>

                  {esOT && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">N° OT</label>
                        <input className="input-base" placeholder="Ej: 15, 22..." autoFocus
                          value={form.numero_ot} onChange={e => setField('numero_ot', e.target.value)} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">N° Registro <span className="text-gray-600 font-normal">(auto)</span></label>
                        <div className="input-base opacity-50 font-mono text-gray-400">{totalRegistros + 1}</div>
                      </div>
                    </div>
                  )}

                  {esOT && (
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Contratista</label>
                      <select className="input-base" value={form.contratista_id} onChange={e => setField('contratista_id', e.target.value)}>
                        <option value="">— Seleccionar —</option>
                        {contratistas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      {cont && <p className="text-xs text-gray-600 mt-1">{cont.contrato}</p>}
                    </div>
                  )}

                  {actividades.length > 0 && (
                    <div className={esOT && motivos.length > 0 ? 'grid grid-cols-2 gap-4' : ''}>
                      <div>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad</label>
                        <select className="input-base" value={form.actividad} onChange={e => setField('actividad', e.target.value)}>
                          {actividades.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      {esOT && motivos.length > 0 && (
                        <div>
                          <label className="text-xs font-semibold text-gray-400 block mb-1">Motivo OT</label>
                          <select className="input-base" value={form.motivo_ot} onChange={e => setField('motivo_ot', e.target.value)}>
                            {motivos.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Cantidad programada</label>
                    <input className="input-base" type="number" min="0" placeholder="Ej: 186"
                      value={form.cantidad_programada} onChange={e => setField('cantidad_programada', e.target.value)} />
                  </div>

                  {/* Campos extra */}
                  {camposExtra.length > 0 && (
                    <div className="grid grid-cols-2 gap-4">
                      {camposExtra.map(campo => (
                        <div key={campo.id}>
                          <label className="text-xs font-semibold text-gray-400 block mb-1">{campo.nombre}{campo.obligatorio?' *':''}</label>
                          {campo.tipo==='lista'&&campo.opciones
                            ? <select className="input-base" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}><option value="">—</option>{campo.opciones.split(',').map(o=><option key={o.trim()} value={o.trim()}>{o.trim()}</option>)}</select>
                            : campo.tipo==='fecha'
                            ? <input className="input-base" type="date" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>
                            : campo.tipo==='numero'
                            ? <input className="input-base" type="number" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>
                            : <input className="input-base" type="text" placeholder={campo.nombre} value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>
                          }
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button className="btn-ghost flex-1" onClick={onClose}>Cancelar</button>
                    <button className="btn-primary flex-1" onClick={() => { setError(''); setStep(2) }}>
                      Siguiente → Fechas
                    </button>
                  </div>
                </div>
              )}

              {/* ── PASO 2: Fechas ── */}
              {step === 2 && (
                <div className="space-y-4">
                  {tieneOffsets ? (
                    <>
                      <div className="p-4 rounded-xl border border-blue-900 text-center" style={{background:'#0c1a2e'}}>
                        <p className="text-xs text-blue-400 font-bold mb-1">📅 Fecha de entrega de la OT</p>
                        <p className="text-xs text-gray-500 mb-3">Las demás fechas se calculan automáticamente a partir de esta.</p>
                        <input className="input-base text-center text-base font-mono" type="date"
                          value={form.datos_extra['doc_fecha_entrega'] || ''}
                          onChange={e => setExtra('doc_fecha_entrega', e.target.value)} />
                      </div>

                      {form.datos_extra['doc_fecha_entrega'] && (
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            {label:'Fecha inicio',       field:'fecha_inicio',             badge:`Entrega +${OFFSETS[modulo.id].inicio}d`},
                            {label:'Fecha fin trabajos', field:'fecha_fin_trabajos',        badge:`Inicio +${OFFSETS[modulo.id].fin}d`},
                            {label:'Fecha límite *',     field:'fecha_limite_expedientes',  badge:`Fin +${OFFSETS[modulo.id].limite}d`},
                          ].map(({label, field, badge}) => (
                            <div key={field} className="p-3 rounded-lg border border-gray-800" style={{background:'#0d1526'}}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs text-gray-400 font-semibold">{label}</span>
                                <span className="text-xs font-mono text-blue-500">{badge}</span>
                              </div>
                              <input className="input-base text-sm" type="date" value={form[field]}
                                onChange={e => setField(field, e.target.value)} />
                            </div>
                          ))}
                        </div>
                      )}

                      {!form.datos_extra['doc_fecha_entrega'] && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha inicio</label>
                            <input className="input-base" type="date" value={form.fecha_inicio} onChange={e=>setField('fecha_inicio',e.target.value)}/>
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha fin trabajos</label>
                            <input className="input-base" type="date" value={form.fecha_fin_trabajos} onChange={e=>setField('fecha_fin_trabajos',e.target.value)}/>
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha límite *</label>
                            <input className="input-base" type="date" value={form.fecha_limite_expedientes} onChange={e=>setField('fecha_limite_expedientes',e.target.value)}/>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha inicio</label>
                        <input className="input-base" type="date" value={form.fecha_inicio} onChange={e=>setField('fecha_inicio',e.target.value)}/>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha fin</label>
                        <input className="input-base" type="date" value={form.fecha_fin_trabajos} onChange={e=>setField('fecha_fin_trabajos',e.target.value)}/>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha límite *</label>
                        <input className="input-base" type="date" value={form.fecha_limite_expedientes} onChange={e=>setField('fecha_limite_expedientes',e.target.value)}/>
                      </div>
                    </div>
                  )}

                  {/* Preview */}
                  {preview && form.fecha_limite_expedientes && (
                    <div className="p-3 rounded-lg bg-gray-900 border border-gray-800 space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><span className="text-gray-600">Progreso</span><div className="font-mono font-bold text-blue-400">{Math.round((preview.progreso||0)*100)}%</div></div>
                        <div><span className="text-gray-600">Plazo</span><div className="font-mono font-bold text-gray-200">{preview.dias_plazo ?? '—'} días</div></div>
                        <div><span className="text-gray-600">Estado</span><div className="font-bold" style={{color:[,'#22c55e','#f97316','#3b82f6','#eab308','#ef4444'][preview.estado]||'#6b7280', fontSize:11}}>{['','✓ A tiempo','⚠ Tarde','● En proceso','⚡ Por vencer','✗ Fuera'][preview.estado]||'—'}</div></div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Semana <span className="text-gray-700">(calculada automáticamente, editable)</span></label>
                        <select className="input-base text-xs" value={form.semana} onChange={e=>setField('semana', e.target.value)}>
                          <option value="">— Seleccionar —</option>
                          {semanas.map(s=><option key={s.label} value={s.label}>{s.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-xs">❌ {error}</div>}

                  <div className="flex gap-3 pt-2">
                    <button className="btn-ghost" onClick={() => setStep(1)}>← Atrás</button>
                    <div className="flex-1"/>
                    {!tienePlantilla && (
                      <button className="btn-primary" onClick={guardar} disabled={saving}>
                        {saving ? '⏳ Guardando...' : '💾 Crear registro'}
                      </button>
                    )}
                    {tienePlantilla && (
                      <button className="btn-primary" onClick={() => {
                        if (!form.fecha_limite_expedientes) { setError('La fecha límite es requerida.'); return }
                        setError(''); setStep(3)
                      }}>
                        Siguiente → Documento
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── PASO 3: Documento ── */}
              {step === 3 && tienePlantilla && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-2">Estos datos se usarán para generar el documento Word. Puedes dejar los campos vacíos para usar los valores del módulo.</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Título del documento</label>
                      <input className="input-base" placeholder={modulo?.plantilla_titulo} name="p3_doc_titulo" autoComplete="off"
                        value={form.datos_extra['doc_titulo']||''} onChange={e=>setExtra('doc_titulo',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Código OT</label>
                      <input className="input-base" placeholder={generarCodigoOT(form.semana, periodo) || 'EPU07IP26'} name="p3_doc_codigo_ot" autoComplete="off"
                        value={form.datos_extra['doc_codigo_ot']||''} onChange={e=>setExtra('doc_codigo_ot',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Plazo de ejecución (doc.)</label>
                      <input className="input-base" type="number" placeholder="1" name="p3_doc_dias_plazo" autoComplete="off"
                        value={form.datos_extra['doc_dias_plazo']||''} onChange={e=>setExtra('doc_dias_plazo',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Cumplimiento</label>
                      <input className="input-base" placeholder={modulo?.plantilla_cumplimiento} name="p3_doc_cumplimiento" autoComplete="off"
                        value={form.datos_extra['doc_cumplimiento']||''} onChange={e=>setExtra('doc_cumplimiento',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad en el doc.</label>
                      <input className="input-base" placeholder={modulo?.plantilla_actividad} name="p3_doc_actividad" autoComplete="off"
                        value={form.datos_extra['doc_actividad']||''} onChange={e=>setExtra('doc_actividad',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Editado por</label>
                      <input className="input-base" placeholder={modulo?.plantilla_editado_por} name="p3_doc_editado_por" autoComplete="off"
                        value={form.datos_extra['doc_editado_por']||''} onChange={e=>setExtra('doc_editado_por',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Firma 1 — Coordinador</label>
                      <input className="input-base" placeholder="CONSORCIO SUPERVISOR" name="p3_doc_coordinador" autoComplete="off"
                        value={form.datos_extra['doc_coordinador']||''} onChange={e=>setExtra('doc_coordinador',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Firma 2 — Área usuaria</label>
                      <input className="input-base" placeholder="ELECTROPUNO S.A.A" name="p3_doc_area_usuaria" autoComplete="off"
                        value={form.datos_extra['doc_area_usuaria']||''} onChange={e=>setExtra('doc_area_usuaria',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Firma 3 — Contratista</label>
                      <input className="input-base" placeholder={cont?.nombre||'—'} name="p3_doc_contratista_firma" autoComplete="off"
                        value={form.datos_extra['doc_contratista_firma']||''} onChange={e=>setExtra('doc_contratista_firma',e.target.value)}/>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-400 block mb-1">Firma 4 <span className="text-gray-600">(si aplica)</span></label>
                      <input className="input-base" placeholder="Opcional" name="p3_doc_firma4" autoComplete="off"
                        value={form.datos_extra['doc_firma4']||''} onChange={e=>setExtra('doc_firma4',e.target.value)}/>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-semibold text-gray-400 block mb-2">Versión del documento</label>
                      <div className="flex gap-2">
                        {[{v:'espacios',l:'✏️ Con espacio para firmar'},{v:'firmado',l:'✍️ Con firmas reales'}].map(({v,l})=>(
                          <label key={v} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 ${(form.datos_extra['doc_version']||'espacios')===v?'border-blue-600 bg-blue-950':'border-gray-800'}`}>
                            <input type="radio" className="accent-blue-500"
                              checked={(form.datos_extra['doc_version']||'espacios')===v}
                              onChange={()=>setExtra('doc_version',v)}/>
                            <span className={`text-xs font-semibold ${(form.datos_extra['doc_version']||'espacios')===v?'text-blue-300':'text-gray-400'}`}>{l}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-xs">❌ {error}</div>}

                  <div className="flex gap-3 pt-2">
                    <button className="btn-ghost" onClick={()=>setStep(2)}>← Atrás</button>
                    <div className="flex-1"/>
                    <button className="btn-primary" onClick={guardar} disabled={saving}>
                      {saving ? '⏳ Guardando...' : '💾 Crear registro'}
                    </button>
                  </div>
                </div>
              )}

              {/* Estado después de guardar */}
              {guardado && (
                <div className="mt-4 p-4 rounded-xl border border-green-800 bg-green-950 text-center">
                  <div className="text-2xl mb-1">✅</div>
                  <div className="text-sm font-bold text-green-300 mb-1">Registro creado</div>
                  <div className="flex gap-2 justify-center mt-3">
                    {tienePlantilla && (
                      <>
                        <button className="btn-ghost text-xs" onClick={descargarWord}>📝 Descargar Word</button>
                        <button className="btn-ghost text-xs" onClick={descargarPdf}>📥 Descargar PDF</button>
                      </>
                    )}
                    <button className="btn-primary text-xs" onClick={onClose}>✓ Cerrar</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ MODO EDITAR — formulario completo ══ */}
          {esEdicion && (
            <div className="space-y-5" style={{maxHeight:'68vh', overflowY:'auto'}}>

              {/* Identificación */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">📌 Identificación</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">N° Registro</label>
                    <div className="input-base opacity-50 font-mono">{ot.numero_registro || '—'}</div>
                  </div>
                  {esOT && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">N° OT</label>
                    <input className="input-base" value={form.numero_ot} onChange={e=>setField('numero_ot',e.target.value)}/>
                  </div>}
                  {esOT && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Contratista</label>
                    <select className="input-base" value={form.contratista_id} onChange={e=>setField('contratista_id',e.target.value)}>
                      <option value="">—</option>
                      {contratistas.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>}
                  {actividades.length>0 && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad</label>
                    <select className="input-base" value={form.actividad} onChange={e=>setField('actividad',e.target.value)}>
                      {actividades.map(a=><option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>}
                  {esOT && motivos.length>0 && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Motivo OT</label>
                    <select className="input-base" value={form.motivo_ot} onChange={e=>setField('motivo_ot',e.target.value)}>
                      {motivos.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">
                      Semana {tieneOffsets && <span className="text-gray-600 font-normal">(auto desde fecha inicio)</span>}
                    </label>
                    <select className="input-base" value={form.semana} onChange={e=>setField('semana',e.target.value)}>
                      <option value="">—</option>
                      {semanas.map(s=><option key={s.label} value={s.label}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Cantidad programada</label>
                    <input className="input-base" type="number" min="0" value={form.cantidad_programada} onChange={e=>setField('cantidad_programada',e.target.value)}/>
                  </div>
                </div>
              </section>

              {/* Fechas */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">📅 Fechas</h3>
                <div className="grid grid-cols-2 gap-4">
                  {tienePlantilla && tieneOffsets && <div className="col-span-2 p-3 rounded-xl border border-blue-900" style={{background:'#0c1a2e'}}>
                    <label className="text-xs font-bold text-blue-400 block mb-1">📅 Fecha entrega OT</label>
                    <input className="input-base" type="date" value={form.datos_extra['doc_fecha_entrega']||''} onChange={e=>setExtra('doc_fecha_entrega',e.target.value)}/>
                  </div>}
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha inicio {tieneOffsets&&<span className="text-blue-500 font-normal">(Entrega +{OFFSETS[modulo.id].inicio}d)</span>}</label>
                    <input className="input-base" type="date" value={form.fecha_inicio} onChange={e=>setField('fecha_inicio',e.target.value)}/>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha fin trabajos {tieneOffsets&&<span className="text-blue-500 font-normal">(Inicio +{OFFSETS[modulo.id].fin}d)</span>}</label>
                    <input className="input-base" type="date" value={form.fecha_fin_trabajos} onChange={e=>setField('fecha_fin_trabajos',e.target.value)}/>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha límite * {tieneOffsets&&<span className="text-blue-500 font-normal">(Fin +{OFFSETS[modulo.id].limite}d)</span>}</label>
                    <input className="input-base" type="date" value={form.fecha_limite_expedientes} onChange={e=>setField('fecha_limite_expedientes',e.target.value)}/>
                  </div>
                </div>
              </section>

              {/* Seguimiento */}
              <section>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">📊 Seguimiento</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha reporte</label>
                    <input className="input-base" type="date" value={form.fecha_reporte} onChange={e=>setField('fecha_reporte',e.target.value)}/>
                  </div>
                  {[1,2,3].includes(modulo?.id) && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Cantidad entregada</label>
                    <input className="input-base" type="number" min="0" value={form.cantidad_entregada||''} onChange={e=>setField('cantidad_entregada',e.target.value)}/>
                    {form.cantidad_programada&&form.cantidad_entregada!==''&&<p className="text-xs mt-1 font-mono" style={{color:Math.round(form.cantidad_entregada/form.cantidad_programada*100)>=100?'#22c55e':Math.round(form.cantidad_entregada/form.cantidad_programada*100)>=80?'#eab308':'#ef4444'}}>{Math.round(form.cantidad_entregada/form.cantidad_programada*100)}% entregado</p>}
                  </div>}
                  {esOT && modulo.tiene_penalidad && <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Penalización manual (S/)</label>
                    <input className="input-base" type="number" min="0" step="0.01" placeholder="0.00" value={form.val_penalidades_manual} onChange={e=>setField('val_penalidades_manual',e.target.value)}/>
                  </div>}
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Observaciones</label>
                    <textarea className="input-base" rows={2} placeholder="Notas, incidencias, justificaciones..." value={form.observaciones} onChange={e=>setField('observaciones',e.target.value)}/>
                  </div>
                </div>
              </section>

              {/* Documento */}
              {tienePlantilla && (
                <section>
                  <h3 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-3">📄 Documento Word</h3>
                  <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-blue-900" style={{background:'#0c1a2e'}}>
                    <div className="col-span-2"><label className="text-xs font-semibold text-gray-400 block mb-1">Título</label><input className="input-base" placeholder={modulo?.plantilla_titulo} value={form.datos_extra['doc_titulo']||''} onChange={e=>setExtra('doc_titulo',e.target.value)} name="st_doc_titulo" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Código OT</label><input className="input-base" placeholder={generarCodigoOT(form.semana, periodo) || 'EPU07IP26'} value={form.datos_extra['doc_codigo_ot']||''} onChange={e=>setExtra('doc_codigo_ot',e.target.value)} name="st_doc_codigo_ot" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Plazo de ejecución (doc.)</label><input className="input-base" type="number" placeholder="1" value={form.datos_extra['doc_dias_plazo']||''} onChange={e=>setExtra('doc_dias_plazo',e.target.value)} name="st_doc_dias_plazo" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Cumplimiento</label><input className="input-base" placeholder={modulo?.plantilla_cumplimiento} value={form.datos_extra['doc_cumplimiento']||''} onChange={e=>setExtra('doc_cumplimiento',e.target.value)} name="st_doc_cumplimiento" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Actividad en doc.</label><input className="input-base" placeholder={modulo?.plantilla_actividad} value={form.datos_extra['doc_actividad']||''} onChange={e=>setExtra('doc_actividad',e.target.value)} name="st_doc_actividad" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Editado por</label><input className="input-base" placeholder={modulo?.plantilla_editado_por} value={form.datos_extra['doc_editado_por']||''} onChange={e=>setExtra('doc_editado_por',e.target.value)} name="st_doc_editado_por" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Firma 1 — Coordinador</label><input className="input-base" placeholder="CONSORCIO SUPERVISOR" value={form.datos_extra['doc_coordinador']||''} onChange={e=>setExtra('doc_coordinador',e.target.value)} name="st_doc_coordinador" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Firma 2 — Área usuaria</label><input className="input-base" placeholder="ELECTROPUNO S.A.A" value={form.datos_extra['doc_area_usuaria']||''} onChange={e=>setExtra('doc_area_usuaria',e.target.value)} name="st_doc_area_usuaria" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Firma 3 — Contratista</label><input className="input-base" placeholder={cont?.nombre||'—'} value={form.datos_extra['doc_contratista_firma']||''} onChange={e=>setExtra('doc_contratista_firma',e.target.value)} name="st_doc_contratista_firma" autoComplete="off"/></div>
                    <div><label className="text-xs font-semibold text-gray-400 block mb-1">Firma 4</label><input className="input-base" placeholder="Opcional" value={form.datos_extra['doc_firma4']||''} onChange={e=>setExtra('doc_firma4',e.target.value)} name="st_doc_firma4" autoComplete="off"/></div>
                  </div>
                </section>
              )}

              {/* Campos extra */}
              {camposExtra.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">🔧 Campos del módulo</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {camposExtra.map(campo=>(
                      <div key={campo.id}>
                        <label className="text-xs font-semibold text-gray-400 block mb-1">{campo.nombre}{campo.obligatorio?' *':''}</label>
                        {campo.tipo==='lista'&&campo.opciones?<select className="input-base" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}><option value="">—</option>{campo.opciones.split(',').map(o=><option key={o.trim()} value={o.trim()}>{o.trim()}</option>)}</select>
                        :campo.tipo==='fecha'?<input className="input-base" type="date" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>
                        :campo.tipo==='numero'?<input className="input-base" type="number" value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>
                        :<input className="input-base" type="text" placeholder={campo.nombre} value={form.datos_extra[campo.clave]||''} onChange={e=>setExtra(campo.clave,e.target.value)}/>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">❌ {error}</div>}
            </div>
          )}
        </div>

        {/* Footer edición */}
        {esEdicion && (
          <div className="modal-footer">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            {guardado && tienePlantilla && <button className="btn-ghost" onClick={descargarWord}>📝 Word</button>}
            {guardado && tienePlantilla && <button className="btn-ghost" onClick={descargarPdf}>📥 PDF</button>}
            {guardado
              ? <button className="btn-primary" onClick={onClose}>✓ Cerrar</button>
              : <button className="btn-primary" onClick={guardar} disabled={saving}>{saving?'⏳ Guardando...':'💾 Guardar cambios'}</button>
            }
          </div>
        )}
      </div>
    </div>
  )
}
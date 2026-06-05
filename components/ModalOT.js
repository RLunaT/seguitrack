'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { calcularCamposOT, calcularCamposConEficiencia, generarSemanas, getNombreOT, fmtMoneda, getEficienciaLabel } from '@/lib/formulas'

const CAMPOS_BASE_KEYS = ['numero_registro','numero_ot','contratista','actividad','motivo_ot','semana',
  'progreso','fecha_inicio','fecha_fin_trabajos','fecha_limite','dias_plazo','cantidad',
  'fecha_reporte','estado','duracion_real','dias_fuera','eficiencia',
  'val_pen','val_total','observaciones','accion_doc']

export default function ModalOT({ modulo, contratistas, camposExtra, actividades, motivos, periodo, ot, onClose, onSave, colsVisibles = {}, totalRegistros = 0 }) {
  const esEdicion = !!ot
  const esOT      = modulo?.tipo === 'ot'   // true = módulo con OT, false = módulo libre
  const año       = parseInt(periodo?.split('-')[0]) || new Date().getFullYear()
  const semanas   = generarSemanas(año)

  function campoVisible(key) {
    // En módulo libre: ocultar campos exclusivos de OT
    if (!esOT && ['numero_ot','motivo_ot','contratista','contrato','accion_doc'].includes(key)) return false
    if (colsVisibles[key] === false) return false
    return true
  }

  const [form, setForm] = useState({
    modulo_id: modulo.id,
    numero_registro: '',
    numero_ot: '',
    contratista_id: '',
    actividad: actividades[0] || '',
    motivo_ot: motivos[0] || '',
    semana: '',
    cantidad_programada: '',
    fecha_inicio: '',
    fecha_fin_trabajos: '',
    fecha_limite_expedientes: '',
    fecha_reporte: '',
    val_penalidades_manual: '',
    observaciones: '',
    datos_extra: {},
  })
  const [preview, setPreview]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (ot) {
      setForm({
        modulo_id:                modulo.id,
        numero_registro:          ot.numero_registro || '',
        numero_ot:                ot.numero_ot || '',
        contratista_id:           ot.contratista_id || '',
        actividad:                ot.actividad || actividades[0] || '',
        motivo_ot:                ot.motivo_ot || motivos[0] || '',
        semana:                   ot.semana || '',
        cantidad_programada:      ot.cantidad_programada || '',
        fecha_inicio:             ot.fecha_inicio || '',
        fecha_fin_trabajos:       ot.fecha_fin_trabajos || '',
        fecha_limite_expedientes: ot.fecha_limite_expedientes || '',
        fecha_reporte:            ot.fecha_reporte || '',
        val_penalidades_manual:   ot.val_penalidades_manual || '',
        observaciones:            ot.observaciones || '',
        datos_extra:              ot.datos_extra || {},
      })
    } else {
      setForm(prev => ({ ...prev, numero_registro: String(totalRegistros + 1) }))
    }
  }, [ot])

  useEffect(() => {
    const cont = contratistas.find(c => c.id === parseInt(form.contratista_id))
    if (!form.fecha_inicio && !form.fecha_limite_expedientes) { setPreview(null); return }
    const calc = calcularCamposConEficiencia({ ...form, contratista_id: parseInt(form.contratista_id) }, cont, periodo)
    setPreview(calc)
  }, [form.fecha_inicio, form.fecha_limite_expedientes, form.fecha_reporte, form.contratista_id, form.val_penalidades_manual])

  function setField(key, val) {
    setForm(prev => {
      const updated = { ...prev, [key]: val }
      if (key === 'fecha_inicio' && val) {
        const dt = new Date(val + 'T00:00:00')
        const semanasAño = generarSemanas(parseInt(periodo?.split('-')[0]) || new Date().getFullYear())
        const encontrada = semanasAño.find(s => {
          const ini = new Date(s.inicio); ini.setHours(0,0,0,0)
          const fin = new Date(s.fin); fin.setHours(23,59,59,999)
          return dt >= ini && dt <= fin
        })
        if (encontrada) updated.semana = encontrada.label
      }
      return updated
    })
  }
  function setExtra(key, val) {
    setForm(prev => ({ ...prev, datos_extra: { ...prev.datos_extra, [key]: val } }))
  }

  async function guardar() {
    if (!form.fecha_limite_expedientes) { setError('La fecha límite es requerida.'); return }
    setError(''); setSaving(true)
    const cont = contratistas.find(c => c.id === parseInt(form.contratista_id))
    const calc = calcularCamposOT({ ...form, contratista_id: parseInt(form.contratista_id) }, cont, periodo)

    // En módulo libre el identificador principal es numero_registro
    // En módulo OT el identificador principal es numero_ot
    const numero_reg = form.numero_registro || String(totalRegistros + 1)
    const numero_ot  = esOT
      ? (form.numero_ot || numero_reg)
      : null  // libre no usa numero_ot

    const payload = {
      modulo_id:                form.modulo_id,
      numero_registro:          numero_reg,
      numero_ot:                numero_ot,
      contratista_id:           esOT && form.contratista_id ? parseInt(form.contratista_id) : null,
      actividad:                form.actividad || null,
      motivo_ot:                esOT ? (form.motivo_ot || null) : null,
      semana:                   form.semana || null,
      cantidad_programada:      form.cantidad_programada ? parseInt(form.cantidad_programada) : null,
      fecha_inicio:             form.fecha_inicio || null,
      fecha_fin_trabajos:       form.fecha_fin_trabajos || null,
      fecha_limite_expedientes: form.fecha_limite_expedientes || null,
      fecha_reporte:            form.fecha_reporte || null,
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
    onSave()
  }

  const cont = contratistas.find(c => c.id === parseInt(form.contratista_id))
  const eficienciaInfo = preview ? getEficienciaLabel(preview.eficiencia) : null

  // Título del modal según tipo
  const tituloModal = esEdicion
    ? `Editar ${esOT ? `OT #${ot.numero_ot || ot.numero_registro}` : `Registro #${ot.numero_registro}`}`
    : `Nuevo ${esOT ? 'Registro de OT' : 'Registro'}`

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div>
            <h2 className="text-base font-bold text-white">{tituloModal}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{modulo.icono} {modulo.nombre} · Periodo {periodo}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800">✕</button>
        </div>

        <div className="p-6 space-y-6" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

          {/* ── Identificación ── */}
          <section>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">📌 Identificación</h3>
            <div className="grid grid-cols-2 gap-4">

              {/* N° Registro — siempre auto */}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  N° Registro <span className="text-blue-500 font-normal">(auto)</span>
                </label>
                <div className="input-base opacity-60 font-mono text-gray-400 flex items-center gap-2">
                  <span>{esEdicion ? (ot.numero_registro || '—') : `${totalRegistros + 1}`}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">Se asigna automáticamente</p>
              </div>

              {/* N° OT — solo en módulos tipo OT */}
              {esOT && campoVisible('numero_ot') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">N° OT</label>
                  <input className="input-base" placeholder="Ej: 01, 05..." value={form.numero_ot}
                    onChange={e => setField('numero_ot', e.target.value)} />
                </div>
              )}

              {/* Contratista — solo en módulos OT */}
              {esOT && campoVisible('contratista') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Contratista</label>
                  <select className="input-base" value={form.contratista_id} onChange={e => setField('contratista_id', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {contratistas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  {cont && <p className="text-xs text-gray-600 mt-1">{cont.contrato} · S/{cont.tasa_penalidad}/día</p>}
                </div>
              )}

              {/* Actividad — visible si hay actividades definidas */}
              {campoVisible('actividad') && actividades.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Actividad</label>
                  <select className="input-base" value={form.actividad} onChange={e => setField('actividad', e.target.value)}>
                    {actividades.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}

              {/* Motivo — solo en módulos OT con motivos */}
              {esOT && campoVisible('motivo_ot') && motivos.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Motivo OT</label>
                  <select className="input-base" value={form.motivo_ot} onChange={e => setField('motivo_ot', e.target.value)}>
                    {motivos.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              {/* Semana */}
              {campoVisible('semana') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">
                    Semana <span className="text-gray-600 font-normal">(auto desde fecha inicio)</span>
                  </label>
                  <select className="input-base" value={form.semana} onChange={e => setField('semana', e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {semanas.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                  </select>
                </div>
              )}

              {/* Contrato (auto) — solo OT */}
              {esOT && campoVisible('contratista') && cont && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Contrato <span className="text-gray-600 font-normal">(auto)</span></label>
                  <input className="input-base opacity-60" value={cont.contrato} readOnly />
                </div>
              )}

              {/* Cantidad */}
              {campoVisible('cantidad') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Cantidad Programada</label>
                  <input className="input-base" type="number" min="0" placeholder="Ej: 186"
                    value={form.cantidad_programada} onChange={e => setField('cantidad_programada', e.target.value)} />
                </div>
              )}
            </div>

            {/* Nombre OT auto — solo en módulos OT */}
            {esOT && form.numero_ot && cont && (
              <div className="mt-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
                <p className="text-xs text-gray-500 mb-1">Nombre OT (auto):</p>
                <p className="text-xs text-blue-300 font-mono">{getNombreOT(form, cont, periodo)}</p>
              </div>
            )}
          </section>

          {/* ── Fechas ── */}
          <section>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">📅 Fechas</h3>
            <div className="grid grid-cols-2 gap-4">
              {campoVisible('fecha_inicio') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha inicio</label>
                  <input className="input-base" type="date" value={form.fecha_inicio}
                    onChange={e => setField('fecha_inicio', e.target.value)} />
                </div>
              )}
              {campoVisible('fecha_fin_trabajos') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">
                    {esOT ? 'Fecha final de trabajos' : 'Fecha de finalización'}
                  </label>
                  <input className="input-base" type="date" value={form.fecha_fin_trabajos}
                    onChange={e => setField('fecha_fin_trabajos', e.target.value)} />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  {esOT ? 'Fecha límite entrega expedientes *' : 'Fecha límite *'}
                </label>
                <input className="input-base" type="date" value={form.fecha_limite_expedientes}
                  onChange={e => setField('fecha_limite_expedientes', e.target.value)} />
              </div>
              {campoVisible('fecha_reporte') && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">
                    {esOT ? 'Fecha reporte de trabajos' : 'Fecha de reporte / cierre'}
                  </label>
                  <input className="input-base" type="date" value={form.fecha_reporte}
                    onChange={e => setField('fecha_reporte', e.target.value)} />
                  <p className="text-xs text-gray-600 mt-1">Al registrar esta fecha se calcula la eficiencia</p>
                </div>
              )}
            </div>
          </section>

          {/* ── Preview cálculos ── */}
          {preview && (
            <section className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">🧮 Cálculos automáticos</h3>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-500">Progreso</div>
                  <div className="font-mono font-bold text-blue-400">{Math.round((preview.progreso||0)*100)}%</div>
                </div>
                <div>
                  <div className="text-gray-500">Días de plazo</div>
                  <div className="font-mono font-bold text-gray-200">{preview.dias_plazo ?? '—'}</div>
                </div>
                <div>
                  <div className="text-gray-500">Estado</div>
                  <div className="font-bold" style={{ color: [,'#22c55e','#f97316','#3b82f6','#eab308','#ef4444'][preview.estado] || '#6b7280' }}>
                    {['','✓ A tiempo','⚠ Tarde','● En proceso','⚡ Por vencer','✗ Fuera de plazo'][preview.estado] || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Duración real</div>
                  <div className="font-mono font-bold text-gray-200">{preview.duracion_real ?? '—'} días</div>
                </div>
                <div>
                  <div className="text-gray-500">Días fuera de plazo</div>
                  <div className="font-mono font-bold" style={{ color: (preview.dias_fuera_plazo||0) > 0 ? '#ef4444' : '#6b7280' }}>
                    {preview.dias_fuera_plazo || 0}
                  </div>
                </div>
                {preview.eficiencia !== null && eficienciaInfo && (
                  <div>
                    <div className="text-gray-500">Eficiencia</div>
                    <div className="font-mono font-bold" style={{ color: eficienciaInfo.color }}>{eficienciaInfo.label}</div>
                  </div>
                )}
                {campoVisible('val_total') && (preview.val_total_penalidad||0) > 0 && (
                  <div>
                    <div className="text-gray-500">Val. total penalidad</div>
                    <div className="font-mono font-bold text-red-400">{fmtMoneda(preview.val_total_penalidad)}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Penalidades y observaciones ── */}
          {(campoVisible('val_pen') || campoVisible('observaciones')) && (
            <section>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                {esOT ? '💰 Penalidades y Observaciones' : '📝 Observaciones'}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {esOT && campoVisible('val_pen') && modulo.tiene_penalidad && (
                  <div>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Valorización de penalidades (manual)</label>
                    <input className="input-base" type="number" min="0" step="0.01" placeholder="0.00"
                      value={form.val_penalidades_manual} onChange={e => setField('val_penalidades_manual', e.target.value)} />
                    <p className="text-xs text-gray-600 mt-1">Se suma al cálculo automático por días fuera</p>
                  </div>
                )}
                {campoVisible('observaciones') && (
                  <div className={esOT && campoVisible('val_pen') && modulo.tiene_penalidad ? '' : 'col-span-2'}>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">Observaciones</label>
                    <textarea className="input-base" rows={3} placeholder="Notas adicionales..."
                      value={form.observaciones} onChange={e => setField('observaciones', e.target.value)} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Campos extra del módulo ── */}
          {camposExtra.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">🔧 Campos del Módulo</h3>
              <div className="grid grid-cols-2 gap-4">
                {camposExtra.map(campo => (
                  <div key={campo.id}>
                    <label className="text-xs font-semibold text-gray-400 block mb-1">
                      {campo.nombre}{campo.obligatorio ? ' *' : ''}
                    </label>
                    {campo.tipo === 'lista' && campo.opciones ? (
                      <select className="input-base" value={form.datos_extra[campo.clave]||''} onChange={e => setExtra(campo.clave, e.target.value)}>
                        <option value="">— Seleccionar —</option>
                        {campo.opciones.split(',').map(o => <option key={o.trim()} value={o.trim()}>{o.trim()}</option>)}
                      </select>
                    ) : campo.tipo === 'fecha' ? (
                      <input className="input-base" type="date" value={form.datos_extra[campo.clave]||''} onChange={e => setExtra(campo.clave, e.target.value)} />
                    ) : campo.tipo === 'numero' ? (
                      <input className="input-base" type="number" value={form.datos_extra[campo.clave]||''} onChange={e => setExtra(campo.clave, e.target.value)} />
                    ) : (
                      <input className="input-base" type="text" placeholder={campo.nombre} value={form.datos_extra[campo.clave]||''} onChange={e => setExtra(campo.clave, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">❌ {error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={guardar} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
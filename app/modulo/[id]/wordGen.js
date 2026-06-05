// wordGen.js — llama al servidor para generar el Word

function fmtFechaWord(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return String(dt.getDate()).padStart(2,'0') + '-' + M[dt.getMonth()] + '-' + dt.getFullYear()
}

function fmtDiaFecha(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const D = ['dom','lun','mar','mié','jue','vie','sáb']
  return D[dt.getDay()] + ' ' + String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear()
}

export async function descargarWordTemplate(f, actividad) {
  const data = {
    numero_ot:          String(f.numero_ot || ''),
    codigo_ot:          String(f.codigo_ot || f.numero_ot || ''),
    contrato:           String(f.contrato || ''),
    fecha_entrega:      fmtFechaWord(f.fecha_entrega),
    fecha_inicio:       fmtDiaFecha(f.fecha_inicio),
    fecha_fin:          fmtDiaFecha(f.fecha_fin),
    fecha_limite:       fmtDiaFecha(f.fecha_limite),
    dias_plazo:         String(f.dias_plazo || '1'),
    cantidad:           String(f.cantidad || ''),
    actividad_doc:      String(f.actividad_doc || f.actividad_label || ''),
    actividad_label:    String(f.actividad_label || ''),
    cumplimiento:       String(f.cumplimiento || 'RESOLUCIÓN N° 227-2013-OS/CD'),
    editado_por:        String(f.editado_por || ''),
    coordinador:        String(f.coordinador || 'CONSORCIO SUPERVISOR'),
    contratista_nombre: String(f.contratista_nombre || ''),
    motivo_extra:       String(f.motivo_extra || f.motivo_ot || ''),
  }

  try {
    const response = await fetch('/api/genword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actividad, data }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Error desconocido' }))
      alert('Error al generar Word: ' + (err.error || response.statusText))
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'OT_' + (data.codigo_ot || data.numero_ot) + '_' + actividad + '.docx'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)

  } catch (err) {
    console.error('Error generando Word:', err)
    alert('Error: ' + (err.message || String(err)))
  }
}
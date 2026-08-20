// wordGen.js — Generación de Word para Instalaciones Nuevas
// Usa dos templates: template_instalaciones.docx (normal) y template_individualizacion.docx

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const DIAS  = ['do','lu','ma','mi','ju','vi','sá']

function fmtFechaWord(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return String(dt.getDate()).padStart(2,'0') + '-' + MESES[dt.getMonth()] + '-' + dt.getFullYear()
}

function fmtFechaTabla(d) {
  // Formato "sá 15/08/2026" para las celdas de la tabla
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  const dia = DIAS[dt.getDay()]
  return `${dia} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}

function diasHabiles(ini, fin) {
  if (!ini || !fin) return ''
  const d1 = new Date(ini + 'T00:00:00')
  const d2 = new Date(fin + 'T00:00:00')
  let dias = 0
  const cur = new Date(d1)
  while (cur <= d2) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) dias++
    cur.setDate(cur.getDate() + 1)
  }
  return `${dias} días`
}

export async function descargarWordInstalaciones(ot, fact, inst, modulo, contratista, esIndividualizacion = false) {
  const template = esIndividualizacion ? 'template_individualizacion.docx' : 'template_instalaciones.docx'

  const vars = {
    numero_ot:    String(ot.numero_ot || ''),
    contrato:     ot.contrato || contratista?.contrato || '',
    fecha_entrega: fmtFechaWord(ot.datos_extra?.doc_fecha_entrega),
    editado_por:  modulo?.plantilla_editado_por || 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',

    // Factibilidades
    fi_fact:    fmtFechaTabla(fact?.fecha_inicio),
    ff_fact:    fmtFechaTabla(fact?.fecha_fin_trabajos),
    fl_fact:    fmtFechaTabla(fact?.fecha_limite_expedientes),
    plazo_fact: diasHabiles(fact?.fecha_inicio, fact?.fecha_fin_trabajos),
    cant_fact:  String(fact?.cantidad_programada || ''),

    // Instalaciones Nuevas
    fi_inst:    fmtFechaTabla(inst?.fecha_inicio),
    ff_inst:    fmtFechaTabla(inst?.fecha_fin_trabajos),
    fl_inst:    fmtFechaTabla(inst?.fecha_limite_expedientes),
    plazo_inst: diasHabiles(inst?.fecha_inicio, inst?.fecha_fin_trabajos),
    cant_inst:  String(inst?.cantidad_programada || ''),

    // Solo para template de individualización
    detalle_fact: ot.datos_extra?.detalle_fact || 'Adjunto listado OT por correo electrónico',
    detalle_inst: ot.datos_extra?.detalle_inst || 'Adjunto listado OT por correo electrónico',
  }

  try {
    const res = await fetch('/api/genword-inst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, vars }),
    })
    if (!res.ok) throw new Error(await res.text())
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `OT-${vars.numero_ot}_Instalaciones_Nuevas.docx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  } catch (e) {
    alert('Error al generar el documento: ' + e.message)
  }
}
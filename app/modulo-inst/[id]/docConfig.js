// docConfig.js — Instalaciones Nuevas
// Mantiene la misma interfaz que app/modulo/[id]/docConfig.js
// para compatibilidad con page.js, pero genera documentos de Instalaciones Nuevas.

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const DIAS  = ['do','lu','ma','mi','ju','vi','sá']

function fmtFechaTabla(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  const dia = DIAS[dt.getDay()]
  return `${dia} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
}

function fmtFechaWord(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return String(dt.getDate()).padStart(2,'0') + '-' + MESES[dt.getMonth()] + '-' + dt.getFullYear()
}

function diasHabiles(ini, fin) {
  if (!ini || !fin) return '—'
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

// getCfg — configuración del formulario de documento (paso 3 del modal)
// Para Instalaciones Nuevas no hay campos de documento extra en el wizard —
// toda la info viene directamente de los campos de la OT.
export function getCfg() {
  return { campos: [] }
}

// buildBody — construye el payload para el endpoint de generación
export function buildBody(ot, cont, cfg, hoy) {
  return {
    numero_ot:    String(ot.numero_ot || ''),
    contrato:     ot.contrato || cont?.contrato || '',
    fecha_entrega: fmtFechaWord(ot.datos_extra?.doc_fecha_entrega),
    editado_por:  cfg?.editado_por || 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',
  }
}

// generarHTMLDoc — preview HTML del documento en el modal (paso 3)
export function generarHTMLDoc(f, modulo, contratista) {
  return `
    <div style="font-family:Arial,sans-serif;font-size:11px;padding:16px;max-width:700px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-weight:bold;font-size:13px;color:#1e4d96">ELECTRO PUNO S.A.A.</div>
          <div style="font-size:10px;color:#666">Empresa Regional de Servicio Público de Electricidad</div>
        </div>
        <div style="text-align:right;font-size:10px">
          <div><b>O.T. N° ${f.numero_ot}</b></div>
          <div>Contrato ${f.contrato}</div>
          <div style="color:#CC0000;font-weight:bold;font-size:13px">${f.fecha_entrega}</div>
        </div>
      </div>
      <div style="text-align:center;font-weight:bold;font-size:12px;margin-bottom:10px;border-bottom:1px solid #ccc;padding-bottom:6px">
        ÓRDENES DE TRABAJO - INSTALACIONES NUEVAS Y FACTIBILIDAD DE SUMINISTROS
      </div>
      <div style="font-size:10px;color:#333">
        <b>ACTIVIDAD:</b> Factibilidad Suministros y Ejecución Instalaciones Nuevas<br>
        <b>EDITADO POR:</b> ${f.editado_por}
      </div>
    </div>
  `
}

// descargarWord — descarga el Word llamando al endpoint
export async function descargarWord(ot, cont, cfg, hoy, esIndividualizacion = false) {
  const template = esIndividualizacion ? 'template_individualizacion.docx' : 'template_instalaciones.docx'
  const vars = buildBody(ot, cont, cfg, hoy)

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
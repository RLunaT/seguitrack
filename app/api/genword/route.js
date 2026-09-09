import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'

function escapeXml(str) {
  if (!str && str !== 0) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Une placeholders partidos en múltiples w:t por Word/spellcheck
// Patrón: <w:t>{</w:t><w:proofErr.../><w:r><w:t>key</w:t></w:r><w:proofErr.../><w:r><w:t>}</w:t>
// → <w:t>{key}</w:t>
function fixSplitPlaceholders(xml) {
  const PROOF = '(?:<w:proofErr[^/]*/>)*'   // cero o más proofErr (spellStart, gramStart, etc.)
  const RUN_OPT_RPR = '<w:r[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?'

  // Caso 1: { en un w:t, key en otro, } en otro
  xml = xml.replace(
    new RegExp(
      `<w:t>\\{<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>([a-z0-9]{1,6})<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>\\}<\\/w:t>`,
      'gs'
    ),
    '<w:t>{$1}</w:t>'
  )

  // Caso 2: texto"{ en un w:t, key en otro, }" en otro
  xml = xml.replace(
    new RegExp(
      `(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)([a-z0-9]{1,6})(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)\\}([^<]*<\\/w:t>)`,
      'gs'
    ),
    (match, pre, sep1, key, sep2, post) => `${pre}{${key}}${post}`
  )

  // Caso 3: {part1 en w:t, part2 en otro, } en tercero  (ej: "{a" | "v" | "}")
  // ANTES que los casos de 2 runs para evitar que absorban splits de 3 runs
  xml = xml.replace(
    new RegExp(
      `(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,5})(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)\\}([^<]*<\\/w:t>)`,
      'gs'
    ),
    (match, pre, p1, sep1, p2, sep2, post) => {
      const key = p1 + p2
      return key.length <= 6 ? `${pre}{${key}}${post}` : match
    }
  )

  // Caso 4: { en w:t, part1 en otro, part2} en tercero  (ej: "{" | "a" | "v}")
  xml = xml.replace(
    new RegExp(
      `(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)([a-z0-9]{1,5})\\}([^<]*<\\/w:t>)`,
      'gs'
    ),
    (match, pre, sep1, p1, sep2, p2, post) => {
      const key = p1 + p2
      return key.length <= 6 ? `${pre}{${key}}${post}` : match
    }
  )

  // Caso 5: {key en un w:t, } en el siguiente
  xml = xml.replace(
    new RegExp(
      `(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,6})(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)\\}([^<]*<\\/w:t>)`,
      'gs'
    ),
    (match, pre, key, sep, post) => `${pre}{${key}}${post}`
  )

  // Caso 6: { en un w:t, key} en el siguiente
  xml = xml.replace(
    new RegExp(
      `(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>${PROOF}${RUN_OPT_RPR}<w:t>)([a-z0-9]{1,6})\\}([^<]*<\\/w:t>)`,
      'gs'
    ),
    (match, pre, sep, key, post) => `${pre}{${key}}${post}`
  )

  return xml
}

function replaceAll(xml, data) {
  let result = fixSplitPlaceholders(xml)
  for (const [key, value] of Object.entries(data)) {
    const tag = '{' + key + '}'
    result = result.split(tag).join(escapeXml(value))
  }
  return result
}

// Extrae el número de ítem desde el nombre del contratista, ej:
// "ÍTEM 2-CONSORCIO ALTIPLANO" → "2". Si el contratista no tiene
// ítem en su nombre (ej. "BUREAU VERITAS DEL PERÚ S.A."), devuelve null.
function extraerItem(nombreContratista) {
  const m = String(nombreContratista || '').match(/[ÍIíi]TEM\s*(\d+)/)
  return m ? m[1] : null
}

// Limpia el número de contrato para usarlo en un nombre de archivo:
// quita el prefijo "Contrato N.°" y cambia "/" por "-" (inválido en archivos).
function limpiarContratoArchivo(contratoRaw) {
  if (!contratoRaw) return ''
  return contratoRaw
    .replace(/^Contrato\s*N\.?°?\s*/i, '')
    .replace(/\//g, '-')
    .trim()
}

// Quita tildes y símbolos especiales (°, etc.) para el nombre de archivo
// ASCII de respaldo, requerido por el header Content-Disposition estándar.
function asciiSeguro(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita tildes
    .replace(/°/g, 'o')
    .replace(/[^\x00-\x7F]/g, '')  // quita cualquier otro caracter no-ASCII
}

// Quita caracteres no válidos en nombres de archivo de Windows/Mac
function sanitizarNombreArchivo(nombre) {
  return nombre.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

// Construye el nombre descriptivo del archivo, ej:
// "ITEM 2 OT N° 01 Reemplazos de medidor P-227 2026-I Semana 03 Contrato 42-2025-ELPU-GG.docx"
function construirNombreArchivo(data, actividad) {
  const item       = extraerItem(data.co)
  const partes     = []
  if (item) partes.push(`ITEM ${item}`)
  partes.push(`OT N° ${data.ot || ''}`)
  if (data.av) partes.push(data.av)
  if (data.periodo) partes.push(data.periodo)
  if (data.semana) partes.push(data.semana)
  const contratoLimpio = limpiarContratoArchivo(data.ct)
  if (contratoLimpio) partes.push(`Contrato ${contratoLimpio}`)

  const nombre = partes.length > 0 ? partes.join(' ') : `OT_${data.ot}_${actividad}`
  return sanitizarNombreArchivo(nombre) + '.docx'
}

function calcPlazoServer(fi, ff) {
  if (!fi || !ff) return ''
  // Aceptar tanto "YYYY-MM-DD" como "YYYY-MM-DDTHH:MM:SS+TZ"
  const clean = s => s.slice(0, 10)
  const d1 = new Date(clean(fi) + 'T00:00:00'), d2 = new Date(clean(ff) + 'T00:00:00')
  if (isNaN(d1) || isNaN(d2)) return ''
  const days = Math.round((d2 - d1) / 86400000) + 1
  return String(days) + (days === 1 ? ' día' : ' días')
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { actividad, modulo_id, data: rawData } = body

    const esContraste = Number(modulo_id) === 1 || actividad === 'Contraste' || actividad === 'Contrastes'
    const plazoCalculado = calcPlazoServer(rawData.fecha_inicio_raw, rawData.fecha_fin_raw)
    const data = {
      ot:  rawData.numero_ot          || '',
      sk:  (() => {
             const mx = (rawData.motivo_extra || rawData.motivo_ot || '').toUpperCase().trim()
             if (mx === 'NTCSE RURAL' || mx === 'NTCSE URBANO') {
               const fi = rawData.fecha_inicio_raw || ''
               const mes = fi
                 ? String(new Date(fi.slice(0, 10) + 'T12:00:00').getMonth() + 1).padStart(2, '0')
                 : '00'
               const sem = ((rawData.semana || '').match(/\d+/) || ['00'])[0].padStart(2, '0')
               const letra = mx === 'NTCSE URBANO' ? 'U' : 'R'
               return `EPUA${mes}-${letra}${sem}`
             }
             return rawData.codigo_ot || rawData.numero_ot || ''
           })(),
      t1:  rawData.fecha_inicio       || '',
      t2:  rawData.fecha_fin          || '',
      t3:  rawData.fecha_limite       || '',
      pz:  esContraste
             ? (plazoCalculado || rawData.plazo_ejecucion || '')
             : (rawData.dias_plazo || ''),
      cn:  rawData.cantidad           || '',
      ac:  rawData.actividad_doc      || rawData.actividad_label || '',
      te:  rawData.fecha_entrega      || '',
      ct:  (rawData.contrato || '').replace(/^contrato\s+/i, '').replace(/^N[.]?[°º]\s*/i, '').trim(),
      cm:  rawData.cumplimiento       || (() => {
             const m = (rawData.motivo_extra || rawData.motivo_ot || '').toUpperCase().trim()
             if (m === 'NTCSE RURAL')   return 'RESOLUCIÓN 496-2005-MEN/DM y NTCSE Rural'
             if (m === 'NTCSE URBANO')  return 'RESOLUCIÓN 496-2005-MEN/DM y NTCSE Urbano'
             return 'RESOLUCIÓN N° 227-2013-OS/CD'
           })(),
      av:  rawData.actividad_label    || '',
      ed:  (() => {
             const mx = (rawData.motivo_extra || rawData.motivo_ot || '').toUpperCase().trim()
             if (mx === 'NTCSE RURAL' || mx === 'NTCSE URBANO')
               return 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES'
             return rawData.editado_por || ''
           })(),
      cr:  rawData.coordinador        || 'CONSORCIO SUPERVISOR',
      co:  rawData.contratista_nombre || '',
      mx:  rawData.motivo_extra       || rawData.motivo_ot || '',
      semana:   rawData.semana   || '',
      periodo:  rawData.periodo  || '',
    }

    // Mapeo principal por modulo_id (estable, no depende del texto libre de "actividad")
    const TEMPLATE_POR_MODULO = {
      2: 'template_avisos.docx',    // Avisos de Medidores
      3: 'template_reemplazo.docx', // Reemplazos de Medidores
    }

    let templateName = TEMPLATE_POR_MODULO[modulo_id]

    // Contraste (modulo_id 1): seleccionar template según motivo_ot
    if (Number(modulo_id) === 1 || actividad === 'Contraste' || actividad === 'Contrastes') {
      const motivo = (rawData.motivo_extra || rawData.motivo_ot || '').toUpperCase().trim()
      if (motivo === 'NTCSE RURAL') {
        templateName = 'template_contrastes_ntcse_rural.docx'
      } else if (motivo === 'NTCSE URBANO') {
        templateName = 'template_contrastes_ntcse_urbano.docx'
      } else {
        templateName = 'template_contrastes.docx' // P-227 y default
      }
    }

    // Fallback: compatibilidad con llamadas antiguas que solo mandan "actividad"
    if (!templateName) {
      if (actividad === 'Avisos') {
        templateName = 'template_avisos.docx'
      } else if (actividad === 'Reemplazo') {
        templateName = 'template_reemplazo.docx'
      }
    }

    if (!templateName) {
      return NextResponse.json({ error: 'No se pudo determinar la plantilla. modulo_id: ' + modulo_id + ', actividad: ' + actividad }, { status: 400 })
    }

    const templatePath = path.join(process.cwd(), 'public', 'templates', templateName)
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado: ' + templateName }, { status: 404 })
    }

    const templateBuffer = fs.readFileSync(templatePath)
    const zip = new PizZip(templateBuffer)

    const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/header2.xml',
                      'word/footer1.xml', 'word/footer2.xml']

    for (const xmlFile of xmlFiles) {
      if (zip.files[xmlFile]) {
        const original = zip.files[xmlFile].asText()
        const replaced = replaceAll(original, data)
        zip.file(xmlFile, replaced)
      }
    }

    const output = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    const filename = construirNombreArchivo(data, actividad)

    return new NextResponse(output, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // El header HTTP estándar (filename="...") solo soporta ASCII de forma
        // segura — tildes y símbolos como "°" se corrompen al viajar así.
        // Se usa filename* con codificación UTF-8 (RFC 5987), que los
        // navegadores modernos prefieren, más un filename= ASCII de respaldo
        // (sin tildes/símbolos) para clientes antiguos que no lo soporten.
        'Content-Disposition': `attachment; filename="${asciiSeguro(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err) {
    console.error('[genword] Error:', err)
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 })
  }
}
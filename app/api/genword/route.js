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
  // Caso 1: { en un w:t, key en otro, } en otro (con posibles w:proofErr entre ellos)
  xml = xml.replace(
    /<w:t>\{<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>([a-z]{1,6})<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>\}<\/w:t>/gs,
    '<w:t>{$1}</w:t>'
  )

  // Caso 2: texto"{  en un w:t, key en otro, }" en otro
  // Ej: SUPERVISOR GENERAL "{ | co | }"
  xml = xml.replace(
    /(<w:t[^>]*>[^<]*)\{(<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>)([a-z]{1,6})(<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>)\}([^<]*<\/w:t>)/gs,
    (match, pre, sep1, key, sep2, post) => `${pre}{${key}}${post.replace(/^/, '')}`
  )

  // Caso 3: genérico — { key } con cualquier XML entre ellos (más agresivo)
  xml = xml.replace(
    /\{((?:<(?!w:t)[^>]+>\s*)*)<w:t[^>]*>([a-z]{1,6})<\/w:t>((?:\s*<(?!w:t)[^>]+>)*)\}/gs,
    (match, pre, key, post) => '{' + key + '}'
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

export async function POST(request) {
  try {
    const body = await request.json()
    const { actividad, modulo_id, data: rawData } = body

    const data = {
      ot:  rawData.numero_ot          || '',
      sk:  rawData.codigo_ot          || rawData.numero_ot || '',
      t1:  rawData.fecha_inicio       || '',
      t2:  rawData.fecha_fin          || '',
      t3:  rawData.fecha_limite       || '',
      pz:  rawData.dias_plazo         || '1',
      cn:  rawData.cantidad           || '',
      ac:  rawData.actividad_doc      || rawData.actividad_label || '',
      te:  rawData.fecha_entrega      || '',
      ct:  rawData.contrato           || '',
      cm:  rawData.cumplimiento       || 'RESOLUCIÓN N° 227-2013-OS/CD',
      av:  rawData.actividad_label    || '',
      ed:  rawData.editado_por        || '',
      cr:  rawData.coordinador        || 'CONSORCIO SUPERVISOR',
      co:  rawData.contratista_nombre || '',
      mx:  rawData.motivo_extra       || rawData.motivo_ot || '',
      semana:   rawData.semana   || '',
      periodo:  rawData.periodo  || '',
    }

    // Mapeo principal por modulo_id (estable, no depende del texto libre de "actividad")
    const TEMPLATE_POR_MODULO = {
      1: 'template_contrastes.docx', // Contrastes de Medidores
      2: 'template_avisos.docx',     // Avisos de Medidores
      3: 'template_reemplazo.docx',  // Reemplazos de Medidores
    }

    let templateName = TEMPLATE_POR_MODULO[modulo_id]

    // Fallback: compatibilidad con llamadas antiguas que solo mandan "actividad"
    if (!templateName) {
      if (actividad === 'Contraste' || actividad === 'Contrastes') {
        templateName = 'template_contrastes.docx'
      } else if (actividad === 'Avisos') {
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
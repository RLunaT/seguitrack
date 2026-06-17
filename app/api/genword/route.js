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
    const filename = `OT_${data.ot}_${actividad}.docx`

    return new NextResponse(output, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[genword] Error:', err)
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 })
  }
}
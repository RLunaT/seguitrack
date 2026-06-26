import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// La conversión a PDF se hace en un servicio externo (Gotenberg en Render,
// plan gratuito) — si lleva más de 15 min sin uso, "despierta" y eso puede
// tardar hasta ~50s. 60s es el máximo permitido en el plan Hobby de
// Vercel, así que le damos ese margen completo.
export const maxDuration = 60

// ───────────────────────────────────────────────────────────────────────
// NOTA: todo lo de aquí abajo (hasta el POST) es una COPIA propia, igual
// a la lógica de generación de Word en app/api/genword/route.js. Es a
// propósito que no se comparte nada entre los dos archivos — así, sin
// importar qué pase con la conversión a PDF, el Word queda intacto.
// ───────────────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (!str && str !== 0) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function fixSplitPlaceholders(xml) {
  xml = xml.replace(
    /<w:t>\{<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>([a-z]{1,6})<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>\}<\/w:t>/gs,
    '<w:t>{$1}</w:t>'
  )
  xml = xml.replace(
    /(<w:t[^>]*>[^<]*)\{(<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>)([a-z]{1,6})(<\/w:t><\/w:r>(?:<w:proofErr[^\/]*\/>)?<w:r[^>]*>(?:<w:rPr>.*?<\/w:rPr>)?<w:t>)\}([^<]*<\/w:t>)/gs,
    (match, pre, sep1, key, sep2, post) => `${pre}{${key}}${post.replace(/^/, '')}`
  )
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

function extraerItem(nombreContratista) {
  const m = String(nombreContratista || '').match(/[ÍIíi]TEM\s*(\d+)/)
  return m ? m[1] : null
}

function limpiarContratoArchivo(contratoRaw) {
  if (!contratoRaw) return ''
  return contratoRaw
    .replace(/^Contrato\s*N\.?°?\s*/i, '')
    .replace(/\//g, '-')
    .trim()
}

function asciiSeguro(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/°/g, 'o')
    .replace(/[^\x00-\x7F]/g, '')
}

function sanitizarNombreArchivo(nombre) {
  return nombre.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

function construirNombreArchivo(data, actividad) {
  const item = extraerItem(data.co)
  const partes = []
  if (item) partes.push(`ITEM ${item}`)
  partes.push(`OT N° ${data.ot || ''}`)
  if (data.av) partes.push(data.av)
  if (data.periodo) partes.push(data.periodo)
  if (data.semana) partes.push(data.semana)
  const contratoLimpio = limpiarContratoArchivo(data.ct)
  if (contratoLimpio) partes.push(`Contrato ${contratoLimpio}`)
  const nombre = partes.length > 0 ? partes.join(' ') : `OT_${data.ot}_${actividad}`
  return sanitizarNombreArchivo(nombre) + '.pdf'
}

// ───────────────────────────────────────────────────────────────────────
// OVERLAY: la caja "O.T. N°/código" y el texto "Contrato N°..." son lo
// único que se ha visto desplazado entre Word y el PDF convertido (todo
// lo demás del documento sale bien). En vez de seguir ajustando la
// plantilla (que depende de que Word y LibreOffice interpreten igual el
// posicionamiento flotante — y nunca lo hacen exactamente igual), se
// TAPA esa franja del PDF ya convertido y se vuelve a dibujar a mano con
// coordenadas fijas. Así la posición final depende solo de estos números,
// no de cómo cada programa calcule el documento.
//
// Estos valores son un primer ajuste visual (en puntos, 1 pulgada = 72pt,
// la página mide 792 x 612 pt en horizontal). Si la posición no calza
// exacta con tu Word, este es el único lugar que hay que tocar — son 4-5
// números, no un cambio estructural.
// ───────────────────────────────────────────────────────────────────────
const OVERLAY_POR_MODULO = {
  1: { left: 506, top: 44, width: 255, height: 25, dividerOffset: 85, contratoTop: 86 }, // Contrastes
  3: { left: 485, top: 44, width: 270, height: 25, dividerOffset: 80, contratoTop: 86 }, // Reemplazo
}

async function aplicarOverlay(pdfBuffer, modulo_id, data) {
  const cfg = OVERLAY_POR_MODULO[modulo_id]
  if (!cfg) return pdfBuffer // Avisos (modulo 2) no lo necesita — no tiene el problema

  const pdfDoc = await PDFDocument.load(pdfBuffer)
  const page = pdfDoc.getPages()[0]
  const { width, height } = page.getSize()

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const boxTopY = height - cfg.top
  const contratoY = height - cfg.contratoTop

  // 1) Tapar con blanco solo la franja de la caja + línea de Contrato —
  //    SIN bajar hasta el título (si se pasa, borra la parte de arriba
  //    de esas letras y se ve partido).
  page.drawRectangle({
    x: cfg.left - 10,
    y: height - (cfg.contratoTop + 4),
    width: width - (cfg.left - 10),
    height: cfg.top + cfg.contratoTop - 4,
    color: rgb(1, 1, 1),
  })

  // 2) Caja con su borde y división interna
  page.drawRectangle({
    x: cfg.left,
    y: boxTopY - cfg.height,
    width: cfg.width,
    height: cfg.height,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  })
  page.drawLine({
    start: { x: cfg.left + cfg.dividerOffset, y: boxTopY },
    end: { x: cfg.left + cfg.dividerOffset, y: boxTopY - cfg.height },
    color: rgb(0, 0, 0),
    thickness: 1,
  })

  // 3) Texto de la caja, con los datos reales de la OT
  page.drawText(`O.T. N°${data.ot || ''}`, {
    x: cfg.left + 8,
    y: boxTopY - cfg.height + 8,
    size: 11,
    font: fontBold,
  })
  page.drawText(String(data.sk || ''), {
    x: cfg.left + cfg.dividerOffset + 12,
    y: boxTopY - cfg.height + 8,
    size: 11,
    font: fontBold,
  })

  // 4) "Contrato N°..." alineado a la derecha del borde derecho de la caja
  const contratoTexto = `Contrato ${data.ct || ''}`
  const anchoTexto = fontReg.widthOfTextAtSize(contratoTexto, 10)
  page.drawText(contratoTexto, {
    x: cfg.left + cfg.width - anchoTexto,
    y: contratoY,
    size: 10,
    font: fontReg,
  })

  return Buffer.from(await pdfDoc.save())
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

    // Mismo mapeo de plantillas que usa Word — para que ambos elijan
    // siempre el mismo documento base para la misma OT.
    const TEMPLATE_POR_MODULO = {
      1: 'template_contrastes.docx',
      2: 'template_avisos.docx',
      3: 'template_reemplazo.docx',
    }
    let templateName = TEMPLATE_POR_MODULO[modulo_id]
    if (!templateName) {
      if (actividad === 'Contraste' || actividad === 'Contrastes') templateName = 'template_contrastes.docx'
      else if (actividad === 'Avisos') templateName = 'template_avisos.docx'
      else if (actividad === 'Reemplazo') templateName = 'template_reemplazo.docx'
    }
    if (!templateName) {
      return NextResponse.json({ error: 'No se pudo determinar la plantilla. modulo_id: ' + modulo_id + ', actividad: ' + actividad }, { status: 400 })
    }

    const templatePath = path.join(process.cwd(), 'public', 'templates', templateName)
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template no encontrado: ' + templateName }, { status: 404 })
    }

    // 1) Generamos el MISMO .docx que se usa para Word (misma plantilla,
    //    mismos datos) — así el PDF no es una reconstrucción aparte, sino
    //    el documento real convertido. No puede haber diferencias de
    //    formato porque es literalmente el mismo archivo.
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
    const docxBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })

    const gotenbergUrl = process.env.GOTENBERG_URL
    if (!gotenbergUrl) {
      return NextResponse.json(
        { error: 'Falta configurar la variable de entorno GOTENBERG_URL (en .env.local y en Vercel → Settings → Environment Variables).' },
        { status: 500 }
      )
    }

    // 2) Convertimos ese .docx a PDF con Gotenberg (microservicio propio,
    //    LibreOffice por debajo) — por eso el resultado calza exacto con
    //    el Word. Gotenberg devuelve el PDF directo, sin envolver en JSON.
    const form = new FormData()
    form.append('files', new Blob([docxBuffer]), 'documento.docx')

    let convRes
    try {
      convRes = await fetch(gotenbergUrl.replace(/\/$/, '') + '/forms/libreoffice/convert', {
        method: 'POST',
        body: form,
      })
    } catch (err) {
      console.error('[genpdf] Error de red llamando a Gotenberg:', err)
      return NextResponse.json({ error: 'No se pudo contactar el servicio de conversión a PDF: ' + (err.message || err) }, { status: 502 })
    }

    if (!convRes.ok) {
      const errBody = await convRes.text().catch(() => '')
      console.error('[genpdf] Gotenberg respondió con error:', convRes.status, errBody)
      return NextResponse.json({ error: 'Error al convertir a PDF (Gotenberg ' + convRes.status + '): ' + errBody }, { status: 502 })
    }

    let pdfBuffer = Buffer.from(await convRes.arrayBuffer())

    // 3) Tapamos y volvemos a dibujar la caja "O.T./código" y el texto
    //    de "Contrato" con coordenadas fijas — ver aplicarOverlay() arriba.
    try {
      pdfBuffer = await aplicarOverlay(pdfBuffer, modulo_id, data)
    } catch (err) {
      console.error('[genpdf] Error al aplicar el overlay (se entrega el PDF sin overlay):', err)
    }

    const filename = construirNombreArchivo(data, actividad)

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${asciiSeguro(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err) {
    console.error('[genpdf]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
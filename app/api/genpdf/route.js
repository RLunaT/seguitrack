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
  // Defensivo: ver mismo comentario en genword/route.js — algunas
  // plantillas .docx traen el color azul (0000FF) puesto a mano en los
  // runs de cumplimiento/actividad/editado por. Se limpia acá también
  // para no depender de que el .docx en disco esté actualizado.
  result = result.replace(/<w:color w:val="0000FF"\s*\/>/g, '')
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
// OVERLAY: reconstruye la sección "O.T. N°/código + Contrato N.°" en el
// PDF ya convertido por Gotenberg, para módulos 1 (Contrastes) y 3 (Reemplazo).
// Módulo 2 (Avisos) se excluye: su conversión ya sale bien de Gotenberg.
//
// POSICIÓN DE LA CAJA:
//   Medida directamente sobre documentos reales generados por Gotenberg.
//   La caja "FECHA ENTREGA OT" (que usamos como referencia de alineación)
//   queda consistentemente en x=504–758 pt para ambos módulos.
//   NO se intenta detectar la posición desde el stream del PDF porque
//   Gotenberg comprime los streams con zlib; decodificar bytes comprimidos
//   como texto y aplicarles regex produce coincidencias falsas con coordenadas
//   basura, lo que puede hacer que el rectángulo blanco cubra casi toda la
//   página (incluyendo el logo).
//
// GEOMETRÍA (página landscape 792×612 pt):
//   fechaLeft  = 504   borde izquierdo de la caja OT = borde izq de FECHA
//   fechaRight = 758   borde derecho  (ambas cajas alineadas)
//   boxWidth   = 254   total de la caja (≈ 110+120px del Word escalados)
//   cellLeft   = 122   celda "O.T. N°X" (≈ 48 %)
//   cellRight  = 132   celda código OT  (≈ 52 %)
//   BOX_HEIGHT =  28   altura de la caja
//   BOX_TOP    =  38   distancia desde el borde superior de la página
const FECHA_LEFT   = 504
const FECHA_RIGHT  = 758
const BOX_HEIGHT   = 28
const BOX_TOP      = 38
const CONTRATO_GAP = 12    // gap entre borde inferior caja y texto Contrato
const FONT_BOX     = 10.5
const FONT_CONTRATO = 9

async function aplicarOverlay(pdfBuffer, modulo_id, data, logoJpegBuffer) {
  // El overlay solo se aplica a módulos 1 (Contrastes) y 3 (Reemplazo).
  // Cualquier otro módulo (Avisos u otros) recibe el PDF tal como lo
  // entrega Gotenberg, sin modificar.
  const mid = Number(modulo_id)
  if (mid !== 1 && mid !== 3) return pdfBuffer

  const pdfDoc = await PDFDocument.load(pdfBuffer)
  const page   = pdfDoc.getPages()[0]
  const { width, height } = page.getSize()

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const boxWidth  = FECHA_RIGHT - FECHA_LEFT   // 254
  const cellLeft  = Math.round(boxWidth * 0.48) // 122  celda "O.T. N°X"
  const cellRight = boxWidth - cellLeft          // 132  celda código
  const dividerX  = FECHA_LEFT + cellLeft

  const boxTopY    = height - BOX_TOP            // ≈ 574
  const boxBottomY = boxTopY - BOX_HEIGHT        // ≈ 546

  // ── 0) Redibujar el logo completo ──────────────────────────────────────
  //    Gotenberg genera un clip path de ~163pt sobre el logo (que debería
  //    ser 221pt). El clip viene de la estructura interna del .docx y no
  //    se puede eliminar desde el template. Solución: borrar la zona del
  //    logo y volver a dibujarlo con pdf-lib a su tamaño correcto (221pt),
  //    sin ningún clip.
  //
  //    Posiciones medidas directamente en los PDFs reales de Gotenberg:
  //      Contrastes (mod 1): logoX=36.8,  logoY=536.2, w=221.25, h=29.85
  //      Reemplazo  (mod 3): logoX=43.15, logoY=536.2, w=221.25, h=29.85
  //    (logoY y h son iguales en ambos — solo varía el x levemente)
  if (logoJpegBuffer) {
    try {
      const logoX = mid === 3 ? 43.15 : 36.8
      const logoY = 536.2   // desde el borde inferior de la página (pdf-lib)
      const logoW = 221.25
      const logoH = 29.85

      // Borrar la zona del logo (incluyendo el clip parcial que dejó Gotenberg)
      page.drawRectangle({
        x: logoX - 2, y: logoY - 2,
        width: logoW + 4, height: logoH + 4,
        color: rgb(1, 1, 1),
      })

      // Redibujar el logo a su tamaño correcto (sin clip)
      const logoImage = await pdfDoc.embedJpg(logoJpegBuffer)
      page.drawImage(logoImage, {
        x: logoX, y: logoY,
        width: logoW, height: logoH,
      })
    } catch (err) {
      console.error('[genpdf] Error al redibujar logo:', err)
    }
  }

  // ── 1) Borrar SOLO la zona de la caja OT + texto Contrato ──────────────
  //    El límite inferior (wipeBottom) se calcula a partir de dónde va a
  //    quedar el texto "Contrato N.°..." redibujado, con un pequeño margen.
  //    Así no pisamos el título del documento (que empieza justo después),
  //    especialmente en módulos con título largo en 2 líneas ("ITEM 4").
  //
  //    wipeBottom = boxBottomY − CONTRATO_GAP − FONT_CONTRATO − 4
  //               = 546 − 12 − 9 − 4 = 521 pt
  //    (vs. height−100 = 512 pt del código anterior: 9 pt más alto, suficiente
  //    para no tapar la primera línea del título en layouts comprimidos)
  const wipeBottom = boxBottomY - CONTRATO_GAP - FONT_CONTRATO - 4
  page.drawRectangle({
    x:      FECHA_LEFT - 5,          // 5 pt a la izquierda de la caja
    y:      wipeBottom,
    width:  width - (FECHA_LEFT - 5),
    height: height - wipeBottom,
    color:  rgb(1, 1, 1),
  })

  // ── 2) Caja exterior ────────────────────────────────────────────────────
  page.drawRectangle({
    x:           FECHA_LEFT,
    y:           boxBottomY,
    width:       boxWidth,
    height:      BOX_HEIGHT,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  })

  // ── 3) Línea divisoria interna ──────────────────────────────────────────
  page.drawLine({
    start:     { x: dividerX, y: boxTopY    },
    end:       { x: dividerX, y: boxBottomY },
    color:     rgb(0, 0, 0),
    thickness: 1,
  })

  // ── 4) Celda izquierda "O.T. N°X" — centrada ───────────────────────────
  const labelOT = `O.T. N°${data.ot || ''}`
  const wOT     = fontBold.widthOfTextAtSize(labelOT, FONT_BOX)
  page.drawText(labelOT, {
    x:    FECHA_LEFT + (cellLeft - wOT) / 2,
    y:    boxBottomY + (BOX_HEIGHT - FONT_BOX) / 2,
    size: FONT_BOX,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  // ── 5) Celda derecha — código OT — centrada ─────────────────────────────
  const labelCod = String(data.sk || '')
  const wCod     = fontBold.widthOfTextAtSize(labelCod, FONT_BOX)
  page.drawText(labelCod, {
    x:    dividerX + (cellRight - wCod) / 2,
    y:    boxBottomY + (BOX_HEIGHT - FONT_BOX) / 2,
    size: FONT_BOX,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  // ── 6) "Contrato N.° ..." — centrado bajo la caja ──────────────────────
  const contratoTxt = `Contrato ${data.ct || ''}`
  const wContrato   = fontReg.widthOfTextAtSize(contratoTxt, FONT_CONTRATO)
  page.drawText(contratoTxt, {
    x:    FECHA_LEFT + (boxWidth - wContrato) / 2,
    y:    boxBottomY - CONTRATO_GAP - FONT_CONTRATO,
    size: FONT_CONTRATO,
    font: fontReg,
    color: rgb(0, 0, 0),
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
    //    También se redibuja el logo completo (Gotenberg lo clipea a ~163pt).
    try {
      // Extraer la imagen del logo del .docx para redibujarla correctamente
      let logoJpeg = null
      try {
        logoJpeg = zip.files['word/media/image1.jpg']?.asBinary()
        if (logoJpeg) logoJpeg = Buffer.from(logoJpeg, 'binary')
      } catch (_) {}
      pdfBuffer = await aplicarOverlay(pdfBuffer, modulo_id, data, logoJpeg)
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
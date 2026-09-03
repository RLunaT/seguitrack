import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export const maxDuration = 60

const GOTENBERG = process.env.GOTENBERG_URL || 'https://seguitrack-gotenberg.onrender.com'

// ── Pre-procesado DOCX para LibreOffice ──────────────────────────────────
// 1. Normaliza <w:w val="125"/> → 100%: LibreOffice computa el layout de
//    forma distinta con escalado de caracteres, rompiendo saltos de línea.
// 2. Elimina los <w:drawing> que contienen <wpg:wgp> (grupos de shapes):
//    LibreOffice los desplaza visualmente. El overlay de pdf-lib los
//    redibuja en la posición correcta, así que no necesitamos que
//    LibreOffice los renderice en absoluto.
function prepararParaPDF(docxBuf, vars) {
  const zip = new PizZip(docxBuf)
  const docXml = zip.files['word/document.xml']?.asText()
  if (!docXml) return docxBuf

  // Solo normalizar valores > 100% (texto expandido causa wrap en LibreOffice).
  // Dejar valores < 100% intactos para no ensanchar texto condensado.
  let fixed = docXml.replace(/<w:w w:val="(\d+)"\/>/g, (m, v) => parseInt(v) > 100 ? '<w:w w:val="100"/>' : m)

  // Procesar <w:drawing> con <wpg:wgp>:
  //   • DGCM-MC → eliminar (el overlay pdf-lib lo redibuja)
  //   • Contiene ">ITEM<" (bloque de firma) → limpiar el texto "ITEM XX"
  //     porque nombre_contratista ya incluye el número (ej: "ÍTEM 1-CONSORCIO ENERGAL")
  //   • Resto → dejar intacto
  fixed = fixed.replace(
    /<w:drawing>(?:(?!<w:drawing>)[\s\S])*?<\/w:drawing>/g,
    (block) => {
      if (!block.includes('<wpg:wgp')) return block
      if (block.includes('DGCM-MC')) return ''
      if (!block.includes('>ITEM<')) return block
      return block
        .replace(/(<w:t[^>]*>)ITEM(<\/w:t>)/g, '$1$2')
        .replace(/(<w:t[^>]*>)04(<\/w:t>)/g, '$1$2')
    },
  )

  zip.file('word/document.xml', fixed)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ── Overlay OT box ───────────────────────────────────────────────────────
// LibreOffice desplaza el texto dentro del grupo de shapes del OT box
// (texto aparece más arriba de lo que debería, haciendo que el borde
// inferior del box parezca un tachado). La solución idéntica a la de
// genpdf/route.js: tapar el área con blanco y redibujar a mano.
//
// Coordenadas medidas exactamente desde los shapes del template XML
// (EMU/12700 → pt). Página landscape A4 (842×595 pt). Y desde borde inferior.
//
// Si el resultado no calza exacto, estos son los únicos valores a tocar:
// Posiciones relativas al grupo (en pt desde el origen del grupo):
//   anchor x=513pt desde borde izquierdo de página
//   grupo width=273pt → borde derecho absoluto = 513+273 = 786pt
//   divider entre celdas: a 79pt desde origen → x absoluto = 592pt
//   altura grupo: 19pt (box interior), padding superior 4pt desde top de página
// topFromPage: distancia desde el BORDE SUPERIOR de la página hasta el tope del box.
// El anchor OOXML dice 4pt desde el margen superior (=32pt desde borde página) → 36pt total.
// Ajustar este valor si el box queda alto o bajo.
const OT_ANCHOR = { x: 513, groupW: 273, divRel: 79, topFromPage: 36, boxH: 19, fontSize: 9.5 }

async function aplicarOverlayReubicacion(pdfBuffer, vars) {
  const pdfDoc = await PDFDocument.load(pdfBuffer)
  const page   = pdfDoc.getPages()[0]
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const { height: pageH } = page.getSize()
  const { x: left, groupW, divRel, topFromPage, boxH, fontSize } = OT_ANCHOR

  const right    = left + groupW          // 786
  const dividerX = left + divRel          // 592
  const topY     = pageH - topFromPage    // desde borde inferior del pdf
  const bottomY  = topY - boxH

  // 1) Tapar el área exacta del OT box con blanco
  page.drawRectangle({
    x: left - 2, y: bottomY - 2,
    width:  groupW + 4,
    height: boxH + 4,
    color: rgb(1, 1, 1),
  })

  // 2) Borde exterior del box
  page.drawRectangle({
    x: left, y: bottomY,
    width: right - left, height: boxH,
    borderColor: rgb(0, 0, 0), borderWidth: 0.75,
  })

  // 3) Divisor vertical entre celdas
  page.drawLine({
    start: { x: dividerX, y: topY },
    end:   { x: dividerX, y: bottomY },
    color: rgb(0, 0, 0), thickness: 0.75,
  })

  // 4) Celda izquierda "O.T. N° X" — centrada horizontalmente y verticalmente
  const labelOT = `O.T. N° ${vars?.numero_ot ?? ''}`
  const wOT = fontBold.widthOfTextAtSize(labelOT, fontSize)
  page.drawText(labelOT, {
    x: left + ((dividerX - left) - wOT) / 2,
    y: bottomY + (boxH - fontSize) / 2,
    size: fontSize, font: fontBold, color: rgb(0, 0, 0),
  })

  // 5) Celda derecha "DGCM-MC-P228" — centrada
  const labelCod = 'DGCM-MC-P228'
  const wCod = fontBold.widthOfTextAtSize(labelCod, fontSize)
  page.drawText(labelCod, {
    x: dividerX + ((right - dividerX) - wCod) / 2,
    y: bottomY + (boxH - fontSize) / 2,
    size: fontSize, font: fontBold, color: rgb(0, 0, 0),
  })

  // El texto "Contrato N.° ..." lo deja el propio documento — no se redibuja
  // para evitar duplicados. Solo el OT box se reconstruye via overlay.

  return Buffer.from(await pdfDoc.save())
}

export async function POST(request) {
  try {
    const { template, vars, pdf = false } = await request.json()

    const templatePath = path.join(process.cwd(), 'public', 'templates', template)
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `Template no encontrado: ${template}` }, { status: 404 })
    }

    const buf = fs.readFileSync(templatePath)
    const zip = new PizZip(buf)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })
    doc.render(vars || {})

    const wordBuf = doc.getZip().generate({
      type: 'nodebuffer',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const nombreBase = `OT-${String(vars?.numero_ot||'doc')}_Instalaciones_Nuevas`

    if (!pdf) {
      return new NextResponse(wordBuf, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${nombreBase}.docx"`,
        },
      })
    }

    // Para PDF: normalizar propiedades que LibreOffice interpreta distinto
    const pdfDocxBuf = template === 'template_reubicacion.docx'
      ? prepararParaPDF(wordBuf, vars)
      : wordBuf

    // Convertir a PDF via Gotenberg
    const form = new FormData()
    form.append('files', new Blob([pdfDocxBuf], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }), 'doc.docx')

    const pdfRes = await fetch(`${GOTENBERG}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    })

    if (!pdfRes.ok) {
      const txt = await pdfRes.text()
      return NextResponse.json({ error: `Gotenberg error: ${txt}` }, { status: 500 })
    }

    let pdfBuf = Buffer.from(await pdfRes.arrayBuffer())

    // Overlay: corrige el OT box desplazado por LibreOffice
    if (template === 'template_reubicacion.docx') {
      try {
        pdfBuf = await aplicarOverlayReubicacion(pdfBuf, vars)
      } catch (err) {
        console.error('[genword-inst] overlay reubicación falló:', err)
      }
    }

    return new NextResponse(pdfBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreBase}.pdf"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

export const maxDuration = 60

const GOTENBERG = process.env.GOTENBERG_URL || 'https://seguitrack-gotenberg.onrender.com'

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

    // Convertir a PDF via Gotenberg en el servidor
    const form = new FormData()
    form.append('files', new Blob([wordBuf], {
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

    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer())
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
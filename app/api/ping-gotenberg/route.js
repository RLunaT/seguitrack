import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const maxDuration = 60

const GOTENBERG = process.env.GOTENBERG_URL || 'https://seguitrack-gotenberg.onrender.com'

// Despierta el servicio LibreOffice de Gotenberg enviando un DOCX mínimo
export async function GET() {
  try {
    // Usar un template real para que LibreOffice tenga que procesarlo de verdad
    const templatePath = path.join(process.cwd(), 'public', 'templates', 'template_instalaciones.docx')
    const docBuf = fs.existsSync(templatePath) ? fs.readFileSync(templatePath) : Buffer.from('')

    const form = new FormData()
    form.append('files', new Blob([docBuf], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }), 'doc.docx')

    const res = await fetch(`${GOTENBERG}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(55000),
    })
    return NextResponse.json({ ok: res.ok, status: res.status })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

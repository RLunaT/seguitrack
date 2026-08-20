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

// Repara placeholders fragmentados por Word en múltiples w:t
function fixSplitPlaceholders(xml) {
  // Estrategia: extraer solo el texto de los w:t y reunir placeholders {{...}}
  // que quedaron partidos entre varios runs
  let result = xml
  // Regex: encuentra secuencias de w:t que juntas forman {{algo}}
  result = result.replace(
    /\{\{([^}]*)\}\}/g,
    (m) => m // placeholders ya completos, dejar igual
  )
  // Reparar {{partido en dos w:t: "{{" en uno, "variable}}" en otro
  result = result.replace(
    /<w:t([^>]*)>\{\{<\/w:t>(<\/w:r>[\s\S]*?<w:r[^>]*>[\s\S]*?)<w:t([^>]*)>([^<]+)\}\}<\/w:t>/g,
    (m, a1, mid, a2, key) => `<w:t${a1}>{{${key}}}</w:t>`
  )
  return result
}

function rellenarTemplate(xml, vars) {
  let out = fixSplitPlaceholders(xml)
  for (const [k, v] of Object.entries(vars)) {
    const escaped = escapeXml(v)
    out = out.replaceAll(`{{${k}}}`, escaped)
  }
  return out
}

export async function POST(request) {
  try {
    const { template, vars } = await request.json()

    const templatePath = path.join(process.cwd(), 'public', template)
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `Template no encontrado: ${template}` }, { status: 404 })
    }

    const buf = fs.readFileSync(templatePath)
    const zip = new PizZip(buf)

    const docXml = zip.file('word/document.xml').asText()
    const filled = rellenarTemplate(docXml, vars || {})
    zip.file('word/document.xml', filled)

    const out = zip.generate({ type: 'nodebuffer', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

    return new NextResponse(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="OT-${escapeXml(vars?.numero_ot || 'doc')}_Instalaciones_Nuevas.docx"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 })
  }
}
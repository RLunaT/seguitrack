/**
 * Script para crear templates de Contraste NTCSE Rural y Urbano
 * a partir de los originales, insertando placeholders {var}.
 *
 * Ejecutar desde el directorio del proyecto:
 *   node <ruta_a_este_script>
 */

const fs   = require('fs')
const path = require('path')
const PizZip = require('pizzip')

// ── Configuración de archivos ─────────────────────────────────────────────
const TEMPLATES_DIR = path.join(process.cwd(), 'public', 'templates')

const SOURCES = {
  urbano: 'G:\\PARA SEGUITRACK\\Templates originales\\OT N° 02 Verificación Posterior en campo NTCSE Urbano 2026-II Contrato 23-2026-ELPU-GG Julio U02.docx',
  rural:  'G:\\PARA SEGUITRACK\\Templates originales\\OT N° 04 Verificación Posterior en campo NTCSE Rural 2026-II Contrato 23-2026-ELPU-GG Agosto R02.docx',
}

const OUTPUTS = {
  urbano: path.join(TEMPLATES_DIR, 'template_contrastes_ntcse_urbano.docx'),
  rural:  path.join(TEMPLATES_DIR, 'template_contrastes_ntcse_rural.docx'),
}

// ── Función auxiliar: une w:t partidos en el mismo párrafo para facilitar
//    el reemplazo posterior. Solo une dentro de un mismo <w:r>.
//    (No altera el estilo — solo combina el texto visible)
function normalizeRunTexts(xml) {
  // Une múltiples <w:t> consecutivos DENTRO de un mismo <w:r>
  // Pattern: <w:t...>TEXT1</w:t><w:t...>TEXT2</w:t> → <w:t>TEXT1TEXT2</w:t>
  // Esto es simplificado; en la práctica Word puede tener proofErr entre ellos
  return xml
}

// ── Reemplazos por tipo ────────────────────────────────────────────────────
// Hacemos reemplazos en el XML crudo, manejando splits comunes.
// fixSplitPlaceholders en route.js se encarga del resto en runtime.

// Patrón exacto del XML de firmas: CONSORCIO SUPERVISOR (sz=18, spacing vals específicos)
const CR_FIRMA_PAT = '<w:t>CONSORCIO</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="2"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-2"/><w:sz w:val="18"/></w:rPr><w:t>SUPERVISOR</w:t></w:r></w:p></w:tc>'
const CR_FIRMA_RPL = '<w:t>{cr}</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="2"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-2"/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r></w:p></w:tc>'

// Patrón exacto del XML de firmas: BV DEL PERÚ S.A. (sz=18) — Urbano (xml:space="preserve")
const CO_FIRMA_PAT = '<w:t>BV</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="3"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>DEL</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="1"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>PERÚ</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="4"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="18"/></w:rPr><w:t>S.A.</w:t></w:r></w:p></w:tc>'
const CO_FIRMA_RPL = '<w:t>{co}</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="3"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="1"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="4"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r></w:p></w:tc>'
// Variante Rural: sin xml:space="preserve" en espacios
const CO_FIRMA_PAT2 = '<w:t>BV</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="3"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>DEL</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="1"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>PERÚ</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="4"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="18"/></w:rPr><w:t>S.A.</w:t></w:r></w:p></w:tc>'
const CO_FIRMA_RPL2 = '<w:t>{co}</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="3"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="1"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="4"/><w:sz w:val="18"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="18"/></w:rPr><w:t></w:t></w:r></w:p></w:tc>'

// Reemplazos comunes a ambos templates (Urbano y Rural)
function applyCommonReplacements(xml) {
  let x = xml

  // ── Contrato ──
  x = x.replace(/<w:t>23-2026-<\/w:t>/g,  '<w:t>{ct}</w:t>')
  x = x.replace(/<w:t>ELPU\/GG<\/w:t>/g,  '<w:t></w:t>')
  x = x.replace(/<w:t>23-2026-ELPU\/GG<\/w:t>/g, '<w:t>{ct}</w:t>')
  x = x.replace(/<w:t>23-2026-ELPU-GG<\/w:t>/g, '<w:t>{ct}</w:t>')

  // ── Fechas de trabajo (split: día + fecha) ──
  x = x.replace(/<w:t>lun<\/w:t>/g, '<w:t>{t1}</w:t>')
  x = x.replace(/<w:t>dom<\/w:t>/g, '<w:t>{t2}</w:t>')
  x = x.replace(/<w:t>mié<\/w:t>/g, '<w:t>{t3}</w:t>')
  // Variantes: "lun 27/07/2026" en un solo nodo
  x = x.replace(/<w:t>lun [0-9]{2}\/[0-9]{2}\/[0-9]{4}<\/w:t>/g, '<w:t>{t1}</w:t>')
  x = x.replace(/<w:t>dom [0-9]{2}\/[0-9]{2}\/[0-9]{4}<\/w:t>/g, '<w:t>{t2}</w:t>')
  x = x.replace(/<w:t>mié [0-9]{2}\/[0-9]{2}\/[0-9]{4}<\/w:t>/g, '<w:t>{t3}</w:t>')
  // Quitar nodo con la fecha (yyyy/mm/dd) que sigue al día
  x = x.replace(/<w:t>[0-9]{2}\/[0-9]{2}\/[0-9]{4}<\/w:t>/g, '<w:t></w:t>')

  // ── Actividad ──
  x = x.replace(/<w:t>Verificación posterior de medidores en campo<\/w:t>/g, '<w:t>{ac}</w:t>')
  x = x.replace(/<w:t>Verificación<\/w:t>/g, '<w:t>{ac}</w:t>')

  // ── Firmas: COORDINADOR GENERAL - CONSORCIO SUPERVISOR ──
  x = x.split(CR_FIRMA_PAT).join(CR_FIRMA_RPL)

  // ── Firmas: COORDINADOR GENERAL - BV DEL PERÚ S.A. ──
  x = x.split(CO_FIRMA_PAT).join(CO_FIRMA_RPL)
  x = x.split(CO_FIRMA_PAT2).join(CO_FIRMA_RPL2)

  // ── Notas: "Consorcio SUPERVISOR" en texto del cuerpo (w:w="105") ──
  // Reemplaza Consorcio → {cr} y SUPERVISOR siguiente → vacío (mismo patrón de spacing)
  x = x.replace(
    /(<w:t>)Consorcio(<\/w:t><\/w:r>(?:<w:r[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*> <\/w:t><\/w:r>)<w:r[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t>)SUPERVISOR(<\/w:t>)/,
    '$1{cr}$2$3'
  )

  return x
}

function applyUrbanoReplacements(xml) {
  let x = applyCommonReplacements(xml)

  // ── OT number ──
  x = x.replace(/<w:t>02<\/w:t>/g, '<w:t>{ot}</w:t>')

  // ── Semana code: EPUA07- + U02 (split) ──
  x = x.replace(/<w:t>EPUA07-<\/w:t>/g, '<w:t>{sk}</w:t>')
  x = x.replace(/<w:t>U02<\/w:t>/g,     '<w:t></w:t>')

  // ── Fecha entrega: "24-Jul-" + "2026" split ──
  x = x.replace(/<w:t>24-Jul-<\/w:t>/g,    '<w:t>{te}</w:t>')
  x = x.replace(/<w:t>24-Jul-2026<\/w:t>/g,'<w:t>{te}</w:t>')

  // ── Cantidad ──
  x = x.replace(/<w:t>196<\/w:t>/g, '<w:t>{cn}</w:t>')

  // ── Plazo de ejecución: valor "1" en celda con Arial MT + spacing -10 + sz 16 ──
  x = x.replace(
    /(<w:rFonts w:ascii="Arial MT"\/>|<w:rFonts w:ascii="Arial MT"\/>[\s\S]*?)(<w:spacing w:val="-10"\/>[\s\S]*?<w:sz w:val="16"\/>[\s\S]*?<\/w:rPr>)(<w:t>)1(<\/w:t><\/w:r><\/w:p><\/w:tc>)/,
    '$1$2$31{pz}$4'
  )
  // Más simple: reemplazar solo en contexto exacto del XML de la celda plazo
  x = x.replace(
    '<w:rFonts w:ascii="Arial MT"/><w:spacing w:val="-10"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:p></w:tc>',
    '<w:rFonts w:ascii="Arial MT"/><w:spacing w:val="-10"/><w:sz w:val="16"/></w:rPr><w:t>{pz}</w:t></w:r></w:p></w:tc>'
  )

  return x
}

function applyRuralReplacements(xml) {
  let x = applyCommonReplacements(xml)

  // ── OT number ──
  x = x.replace(/<w:t>04<\/w:t>/g, '<w:t>{ot}</w:t>')

  // ── Semana code: EPUA08-R02 ──
  x = x.replace(/<w:t>EPUA08-<\/w:t>/g, '<w:t>{sk}</w:t>')
  x = x.replace(/<w:t>R02<\/w:t>/g,     '<w:t></w:t>')
  x = x.replace(/<w:t>EPUA08-R02<\/w:t>/g, '<w:t>{sk}</w:t>')

  // ── Fecha entrega: "07-Ago-" + "2026" split ──
  x = x.replace(/<w:t>07-Ago-<\/w:t>/g,    '<w:t>{te}</w:t>')
  x = x.replace(/<w:t>07-Ago-2026<\/w:t>/g,'<w:t>{te}</w:t>')

  // ── Cantidad ──
  x = x.replace(/<w:t>274<\/w:t>/g, '<w:t>{cn}</w:t>')

  // ── Plazo de ejecución: "7" + " " + "diás" (split en 3 nodos) ──
  // El patrón exacto del XML (sz=17, spacing=2 para espacio, spacing=-4 para diás)
  x = x.replace(
    '<w:t>7</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="2"/><w:sz w:val="17"/></w:rPr><w:t> </w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="17"/></w:rPr><w:t>diás</w:t></w:r></w:p></w:tc>',
    '<w:t>{pz}</w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="2"/><w:sz w:val="17"/></w:rPr><w:t></w:t></w:r><w:r><w:rPr><w:b/><w:spacing w:val="-4"/><w:sz w:val="17"/></w:rPr><w:t></w:t></w:r></w:p></w:tc>'
  )

  return x
}

// ── Función principal ─────────────────────────────────────────────────────
function createTemplate(srcPath, outPath, applyFn, label) {
  console.log(`\n[${label}] Leyendo: ${srcPath}`)
  const buf  = fs.readFileSync(srcPath)
  const zip  = new PizZip(buf)

  const XML_FILES = ['word/document.xml', 'word/header1.xml', 'word/header2.xml',
                     'word/footer1.xml',  'word/footer2.xml']

  let replacedCount = 0
  for (const f of XML_FILES) {
    if (!zip.files[f]) continue
    const original = zip.files[f].asText()
    const replaced  = applyFn(original)
    zip.file(f, replaced)
    if (original !== replaced) {
      const diff = [...replaced.matchAll(/\{[a-z]{1,4}\}/g)].length
      console.log(`  ✓ ${f}: ${diff} placeholders insertados`)
      replacedCount++
    }
  }

  const output = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  fs.writeFileSync(outPath, output)
  console.log(`  → Guardado: ${outPath}`)
  return replacedCount
}

// ── Verificación de archivos fuente ──────────────────────────────────────
for (const [key, src] of Object.entries(SOURCES)) {
  if (!fs.existsSync(src)) {
    console.error(`ERROR: No se encontró el archivo fuente: ${src}`)
    process.exit(1)
  }
}

// ── Ejecución ─────────────────────────────────────────────────────────────
console.log('Creando templates NTCSE para Contrastes...')
createTemplate(SOURCES.urbano, OUTPUTS.urbano, applyUrbanoReplacements, 'NTCSE URBANO')
createTemplate(SOURCES.rural,  OUTPUTS.rural,  applyRuralReplacements,  'NTCSE RURAL')
console.log('\n✓ Templates creados exitosamente.')

// ── Post-verificación: mostrar los placeholders encontrados en cada template ──
for (const [key, outPath] of Object.entries(OUTPUTS)) {
  const buf = fs.readFileSync(outPath)
  const zip = new PizZip(buf)
  const docXml = zip.files['word/document.xml'].asText()
  const placeholders = [...docXml.matchAll(/\{[a-z]{1,4}\}/g)].map(m => m[0])
  const unique = [...new Set(placeholders)]
  console.log(`\n${key.toUpperCase()} placeholders: ${unique.join(', ')}`)
}

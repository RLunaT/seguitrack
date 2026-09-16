import fs from 'fs'
import PizZip from 'pizzip'

const DEST = 'C:/Users/ROSMERY/Desktop/seguitrack/public/templates/template_notificacion_colectivos.docx'
const buf  = fs.readFileSync(DEST)
const zip  = new PizZip(buf)
let xml    = zip.files['word/document.xml'].asText()

// Añadir w:spacing en los párrafos de una fila dada dentro del XML de la fila
function addSpacingToRow(rowXml, before, after) {
  return rowXml.replace(/<\/w:pPr>/g, `<w:spacing w:before="${before}" w:after="${after}"/></w:pPr>`)
}

// Localizar Tabla 4 (la tabla de datos con placeholders OT, sk, t1…)
// Nos apoyamos en que contiene "{ot}" y "{sk}" para identificarla
const parts = xml.split('<w:tbl>')
let rebuilt = parts[0]

for (let i = 1; i < parts.length; i++) {
  rebuilt += '<w:tbl>'
  const tbl = parts[i]

  if (tbl.includes('{t1}') || tbl.includes('{ot}')) {
    // Es la tabla de datos — parchear fila header (1ª) y fila datos (2ª)
    const rowMatches = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)]
    let patched = tbl
    if (rowMatches.length >= 2) {
      const row1 = rowMatches[0][0]
      const row2 = rowMatches[1][0]

      // Fila 1 — header: spacing 100/100 + hRule=exact 1000
      let r1 = row1.replace(/<w:trHeight[^/]*\/>/, '<w:trHeight w:hRule="exact" w:val="1000"/>')
      if (!r1.includes('w:trHeight')) r1 = r1.replace('<w:trPr>', '<w:trPr><w:trHeight w:hRule="exact" w:val="1000"/>')
      r1 = addSpacingToRow(r1, 80, 80)

      // Fila 2 — datos: spacing 80/80 + hRule=exact 680
      let r2 = row2.replace(/<w:trHeight[^/]*\/>/, '<w:trHeight w:hRule="exact" w:val="680"/>')
      if (!r2.includes('w:trHeight')) r2 = r2.replace('<w:trPr>', '<w:trPr><w:trHeight w:hRule="exact" w:val="680"/>')
      r2 = addSpacingToRow(r2, 60, 60)

      patched = tbl.replace(row1, r1).replace(row2, r2)
      console.log('Tabla datos — fila header parcheada con', (r1.match(/w:spacing/g)||[]).length, 'párrafos')
      console.log('Tabla datos — fila datos parcheada con',  (r2.match(/w:spacing/g)||[]).length, 'párrafos')
    }
    rebuilt += patched
  } else {
    rebuilt += tbl
  }
}

xml = rebuilt
zip.file('word/document.xml', xml)
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
fs.writeFileSync(DEST, out)
console.log('Template guardado:', out.length, 'bytes')

const PizZip = require('pizzip')
const fs = require('fs')

function fixSplitPlaceholders(xml) {
  const PROOF = '(?:<w:proofErr[^/]*/>)*'
  const RUN_OPT_RPR = '<w:r[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?'

  xml = xml.replace(new RegExp('<w:t>\\{<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>([a-z0-9]{1,6})<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>\\}<\\/w:t>', 'gs'), '<w:t>{$1}</w:t>')
  xml = xml.replace(new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,6})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'), (m, pre, s1, key, s2, post) => `${pre}{${key}}${post}`)
  xml = xml.replace(new RegExp('(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,6})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'), (m, pre, key, sep, post) => `${pre}{${key}}${post}`)
  xml = xml.replace(new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,6})\\}([^<]*<\\/w:t>)', 'gs'), (m, pre, sep, key, post) => `${pre}{${key}}${post}`)
  xml = xml.replace(new RegExp('(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'), (m, pre, p1, s1, p2, s2, post) => { const k=p1+p2; return k.length<=6 ? `${pre}{${k}}${post}` : m })
  xml = xml.replace(new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})\\}([^<]*<\\/w:t>)', 'gs'), (m, pre, s1, p1, s2, p2, post) => { const k=p1+p2; return k.length<=6 ? `${pre}{${k}}${post}` : m })
  return xml
}

const name = 'template_contrastes_ntcse_urbano.docx'
const buf = fs.readFileSync('public/templates/' + name)
const zip = new PizZip(buf)

// Revisar todos los archivos XML
const xmlFiles = Object.keys(zip.files).filter(f => f.endsWith('.xml'))
xmlFiles.forEach(f => {
  const raw = zip.files[f].asText()
  const fixed = fixSplitPlaceholders(raw)
  const phs = [...fixed.matchAll(/\{[a-z0-9]{1,6}\}/g)].map(m => m[0])
  if (phs.length) console.log(f + ':', [...new Set(phs)].join(', '))
  // Mostrar cualquier { restante (no reemplazado)
  const remaining = [...raw.matchAll(/\{[a-z]/g)]
  if (remaining.length) console.log('  SPLITS sin resolver en RAW:', remaining.map(m => raw.slice(m.index, m.index+60)))
})

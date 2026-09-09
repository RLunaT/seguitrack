const PizZip = require('pizzip')
const fs = require('fs')

function fixSplitPlaceholders(xml) {
  const PROOF = '(?:<w:proofErr[^/]*/>)*'
  const RUN_OPT_RPR = '<w:r[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?'

  xml = xml.replace(
    new RegExp('<w:t>\\{<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>([a-z0-9]{1,6})<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>\\}<\\/w:t>', 'gs'),
    '<w:t>{$1}</w:t>'
  )
  xml = xml.replace(
    new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,6})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'),
    (m, pre, s1, key, s2, post) => `${pre}{${key}}${post}`
  )
  xml = xml.replace(
    new RegExp('(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,6})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'),
    (m, pre, key, sep, post) => `${pre}{${key}}${post}`
  )
  xml = xml.replace(
    new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,6})\\}([^<]*<\\/w:t>)', 'gs'),
    (m, pre, sep, key, post) => `${pre}{${key}}${post}`
  )
  // Caso 5: {part1 | part2 | }
  xml = xml.replace(
    new RegExp('(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)', 'gs'),
    (m, pre, p1, s1, p2, s2, post) => { const k = p1+p2; return k.length<=6 ? `${pre}{${k}}${post}` : m }
  )
  // Caso 6: { | part1 | part2}
  xml = xml.replace(
    new RegExp('(<w:t[^>]*>[^<]*)\\{(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})\\}([^<]*<\\/w:t>)', 'gs'),
    (m, pre, s1, p1, s2, p2, post) => { const k = p1+p2; return k.length<=6 ? `${pre}{${k}}${post}` : m }
  )
  return xml
}

for (const name of ['template_contrastes_ntcse_rural.docx', 'template_contrastes_ntcse_urbano.docx', 'template_contrastes.docx']) {
  try {
    const buf = fs.readFileSync('public/templates/' + name)
    const zip = new PizZip(buf)
    const xml = zip.files['word/document.xml'].asText()
    const fixed = fixSplitPlaceholders(xml)
    const phs = [...new Set([...fixed.matchAll(/\{[a-z0-9]{1,6}\}/g)].map(m => m[0]))]
    console.log(name + ':', phs.join(', '))
  } catch(e) { console.log(name + ': ERROR', e.message) }
}

const PizZip = require('pizzip')
const fs = require('fs')

const PROOF = '(?:<w:proofErr[^/]*/>)*'
const RUN_OPT_RPR = '<w:r[^>]*>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?'

// Test Caso 5 directly on the exact snippet
const snippet = '<w:t>{a</w:t></w:r><w:r w:rsidR="00082138"><w:rPr><w:b/><w:color w:val="0000FF"/><w:sz w:val="19"/></w:rPr><w:t>v</w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="0000FF"/><w:sz w:val="19"/></w:rPr><w:t>}</w:t></w:r>'

const pat5 = new RegExp(
  '(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)([a-z0-9]{1,5})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)',
  'gs'
)
const result = snippet.replace(pat5, (m, pre, p1, s1, p2, s2, post) => {
  const k = p1+p2
  console.log('MATCH! p1='+p1+' p2='+p2+' key='+k)
  return k.length<=6 ? `${pre}{${k}}${post}` : m
})
console.log('Input: ', snippet.slice(0,80))
console.log('Output:', result.slice(0,80))

// Also test Caso 3 on same snippet (shouldn't match)
const pat3 = new RegExp(
  '(<w:t[^>]*>[^<]*)\\{([a-z0-9]{1,6})(<\\/w:t><\\/w:r>' + PROOF + RUN_OPT_RPR + '<w:t>)\\}([^<]*<\\/w:t>)',
  'gs'
)
const r3 = snippet.replace(pat3, (m, pre, key, sep, post) => {
  console.log('Caso 3 MATCH! key='+key)
  return `${pre}{${key}}${post}`
})
console.log('Caso 3 result:', r3.slice(0,80))

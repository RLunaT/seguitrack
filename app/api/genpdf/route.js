import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

function fmtD(d) {
  if (!d) return '\u2014'
  const dt = new Date(d + 'T00:00:00')
  const D = ['dom','lun','mar','mi\u00e9','jue','vie','s\u00e1b']
  return D[dt.getDay()] + ' ' + String(dt.getDate()).padStart(2,'0') + '/' +
         String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear()
}
function fmtE(d) {
  if (!d) return '\u2014'
  const dt = new Date(d + 'T00:00:00')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return String(dt.getDate()).padStart(2,'0') + '-' + M[dt.getMonth()] + '-' + dt.getFullYear()
}
function getLogo() {
  try {
    for (const [ext, mime] of [['png','image/png'],['jpg','image/jpeg']]) {
      const p = path.join(process.cwd(), 'public', 'logo.' + ext)
      if (fs.existsSync(p)) return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64')
    }
  } catch {}
  return ''
}

function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function th(bg,w,t) { return '<th style="width:'+w+';background:'+bg+';border:1px solid #000;padding:2px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact">'+t+'</th>' }
function td(align,v) { return '<td style="border:1px solid #000;padding:2px;text-align:'+align+'">'+esc(v)+'</td>' }

function header(f, logo, titulo) {
  return '<table style="width:100%;border-collapse:collapse;margin-bottom:3px"><tr valign="middle">' +
    '<td style="border:none;padding:0">'+(logo?'<img src="'+logo+'" style="height:44px;display:block" alt=""/>':'')+'</td>' +
    '<td style="border:none;padding:0;text-align:right;vertical-align:top"><table style="border-collapse:collapse;margin-left:auto"><tr>' +
    '<td style="border:1px solid #000;padding:2px 8px;font-size:10.5pt;font-weight:bold">O.T. N\u00b0'+esc(f.ot)+'</td>' +
    '<td style="border:1px solid #000;padding:2px 8px;font-size:10.5pt;font-weight:bold">'+esc(f.sk)+'</td>' +
    '</tr></table></td></tr></table>' +
    '<p style="font-size:9pt;margin:1px 0">Contrato N\u00b0 '+esc(f.ct)+'</p>' +
    '<p style="text-align:center;font-size:11pt;font-weight:bold;text-transform:uppercase;margin:3px 0">'+titulo+'</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:3px"><tr valign="top">' +
    '<td style="border:none;padding:0">' +
    '<p style="font-size:9pt;font-weight:bold;margin:1px 0">CUMPLIMIENTO : <span style="color:#0000FF">'+esc(f.cm)+'</span></p>' +
    '<p style="font-size:9pt;font-weight:bold;margin:1px 0">ACTIVIDAD : <span style="color:#0000FF">'+esc(f.av)+'</span></p>' +
    '<p style="font-size:9pt;font-weight:bold;margin:1px 0">EDITADO POR : <span style="color:#0000FF">'+esc(f.ed)+'</span></p>' +
    '</td><td style="border:none;padding:0;text-align:right;vertical-align:top">' +
    '<table style="border-collapse:collapse;border:2px solid #000;margin-left:auto"><tr><td style="padding:2px 14px;text-align:center">' +
    '<div style="font-size:8pt;font-weight:bold">FECHA ENTREGA OT</div>' +
    '<div style="font-size:15pt;font-weight:bold;color:#CC0000">'+esc(f.te)+'</div>' +
    '</td></tr></table></td></tr></table>'
}

function buildContrastes(f, logo) {
  const bg = '#FCE4D6'
  return header(f,logo,'ORDEN DE TRABAJO - VERIFICACI\u00d3N POSTERIOR DE MEDIDORES EN CAMPO - PROCEDIMIENTO 227')+
    '<table style="width:100%;border-collapse:collapse;font-size:8.5pt"><tr>'+
    th(bg,'2.4%','N\u00b0')+th(bg,'4.7%','OT')+th(bg,'7.9%','Semana')+
    th(bg,'14%','Fecha inicio trabajo')+th(bg,'14%','Fecha final trabajo')+
    th(bg,'16%','Fecha l\u00edmite entrega de<br>Expedientes (1)')+
    th(bg,'9%','Plazo de ejecuci\u00f3n (2)')+th(bg,'7%','Cantidad (3)')+th(bg,'','Actividad (4)')+
    '</tr><tr>'+td('center','1')+td('center',f.ot)+td('center',f.sk)+td('center',f.t1)+td('center',f.t2)+td('center',f.t3)+td('center',f.pz)+td('center',f.cn)+td('left',f.ac)+
    '</tr></table>'+
    '<div style="font-size:7.5pt;margin:2px 0">(1) Incluye 9 fotos verificaci\u00f3n posterior de medidor (Programado y Alternativo), sustentos uso alternativos (Impreso a color 2 ejemplares, constancia oposici\u00f3n y/o constataci\u00f3n policial) Cada primer d\u00eda h\u00e1bil entregar suministros desaprobados, suministros alternativos. En archivo excel, formato establecido</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">(2) En cumplimiento RM 496-2005-MEM/DM y Resoluci\u00f3n 227-2013-OS/CD. Realizar en el d\u00eda programado bajo responsabilidad, incluye medidores 2012 al 2017</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">(3) Se entrega archivo digital total programaci\u00f3n semanal correspondiente.</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>IMPORTANTE:</b> En fiel cumplimiento RM 496-2005-MEM/DM y Resoluci\u00f3n 227-2013-OS/CD. Informar las observaciones encontrados en los trabajos ejecutados m\u00e1ximo al d\u00eda siguiente<br>El <b>NO</b> reportar al WhatsApp grupal los <b>CNR y MEDIDORES DESAPROBADOS (POR CORREO ELECTR\u00d3NICO con copia a CONTROL DE P\u00c9RDIDAS)</b> seg\u00fan sea el caso se aplicar\u00e1 estrictamente penalidades y de ser posible retiro del personal involucrado. Presentarse cada inicio de semana a la oficina de cada unidad Zonal debidamente uniformado y con fotocheck, BAJO RESPONSABILIDAD</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>NOTA:</b> '+esc(f.cr)+' informar diariamente el cumplimiento de la programaci\u00f3n con evidencias fotogr\u00e1ficas en conformidad a los TDRs del contrato suscrito con EPU e informe t\u00e9cnico cada quincena. Supervisar estrictamente <b>CAMBIO DE MEDIDORES</b> que fueron desaprobados por la empresa '+esc(f.co)+', bajo responsabilidad</div>'+
    '<div style="font-size:7.5pt;font-weight:bold;margin:3px 0">NOTIFICADO: La falsa informaci\u00f3n es llenar las actas con datos inexactos, digitar con informaci\u00f3n inexacta y entregar actas corregidas al cliente (Se aplica penalidad respectiva)</div>'+
    '<table style="width:100%;border-collapse:collapse;margin-top:8px"><tr>'+
    '<td style="width:33%;border:1px solid #000;padding:4px;font-size:8pt;font-weight:bold;text-align:center">\u00c1REA USUARIA - ELECTROPUNO S.A.A.</td>'+
    '<td style="width:34%;border:1px solid #000;padding:4px;font-size:8pt;font-weight:bold;text-align:center">COORDINADOR GENERAL - '+esc(f.cr)+'</td>'+
    '<td style="border:1px solid #000;padding:4px;font-size:8pt;font-weight:bold;text-align:center">COORDINADOR GENERAL - '+esc(f.co)+'</td>'+
    '</tr><tr><td style="border:1px solid #000;height:35px"></td><td style="border:1px solid #000"></td><td style="border:1px solid #000"></td></tr></table>'+
    '<table style="width:50%;border-collapse:collapse;margin:4px auto 0"><tr>'+
    '<td style="border:1px solid #000;padding:4px;font-size:8pt;font-weight:bold;text-align:center">SUPERVISOR ZONAL (Autorizaci\u00f3n)</td>'+
    '</tr><tr><td style="border:1px solid #000;height:35px"></td></tr></table>'
}

function buildAvisos(f, logo) {
  const bg='#99FF33', fbg='background:#DDEBF7;-webkit-print-color-adjust:exact;print-color-adjust:exact'
  return header(f,logo,'ORDEN DE TRABAJO - AVISOS DE VERIFICACI\u00d3N DEL SISTEMA DE MEDICI\u00d3N POR P-227 - ITEM 4')+
    '<table style="width:100%;border-collapse:collapse;font-size:8.5pt"><tr>'+
    th(bg,'2.3%','N\u00b0')+th(bg,'4.3%','OT')+th(bg,'8%','Semana')+th(bg,'13%','Fecha inicio trabajo')+th(bg,'12%','Fecha final trabajo')+
    th(bg,'14%','Fecha l\u00edmite entrega de Expedientes (1)')+th(bg,'8%','Plazo de ejecuci\u00f3n (2)')+th(bg,'6%','Cantidad (3)')+th(bg,'','Actividad (4)')+
    '</tr><tr>'+td('center','1')+td('center',f.ot)+td('center',f.sk)+td('center',f.t1)+td('center',f.t2)+td('center',f.t3)+td('center',f.pz)+td('center',f.cn)+td('left',f.ac)+
    '</tr></table>'+
    '<div style="font-size:7.5pt;margin:2px 0">(1) Fecha l\u00edmite entrega Incluye cargo, avisos de la verificaci\u00f3n de medici\u00f3n y CD con todos los trabajos ejecutados con datos completos sin omisiones ni errores ingresados a mesa de partes. Notificar como m\u00ednimo 2 d\u00edas h\u00e1biles a la fecha programada con evidencias fotogr\u00e1ficas y deben estar firmados el 100%</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">(3) Se entrega la cantidad digital indicado de avisos y entregar en orden (Rotulado como indica semana)</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>IMPORTANTE:</b> Cumplimento estricto de las siguientes indicaciones:<br>a) Los <b>CAMBIOS DE MEDIDORES</b> deben realizarse como m\u00e1ximo en 48 horas desde la publicaci\u00f3n en WhatsApp grupal y informe de Contraste, reportar la ejecuci\u00f3n inmediatamente bajo responsabilidad.<br>b) Los <b>CAMBIOS DE MEDIDORES</b> se deben de informar en el SIELSE, subir expediente al SIELSE el archivo de Actas escaneados, Fotograf\u00edas del antes y despu\u00e9s de la ejecuci\u00f3n.<br>c) Reporte digital en archivo Excel, fotograf\u00edas fechadas y georeferenciadas enviadas por correo electr\u00f3nico en formatos establecidos.</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>NOTA:</b> '+esc(f.cr)+' informar diariamente con evidencias fotogr\u00e1ficas en conformidad a los TDRs del contrato suscrito con EPU e informe t\u00e9cnico cada quincena</div>'+
    '<table style="width:100%;border-collapse:collapse;margin-top:8px"><tr>'+
    '<td style="width:33%;'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">SUPERVISOR GENERAL &quot;'+esc(f.cr)+'&quot;</td>'+
    '<td style="width:34%;'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">\u00c1REA USUARIA ELECTROPUNO S.A.A.</td>'+
    '<td style="'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">COORDINADOR Y/O SUPERVISOR &quot;'+esc(f.co)+'&quot;</td>'+
    '</tr><tr><td style="border:1px solid #000;height:21mm"></td><td style="border:1px solid #000"></td><td style="border:1px solid #000"></td></tr>'+
    '<tr><td style="border:1px solid #000;height:4mm;text-align:center;font-size:7pt">________________</td><td style="border:1px solid #000;text-align:center;font-size:7pt">________________</td><td style="border:1px solid #000;text-align:center;font-size:7pt">________________</td></tr></table>'
}

function buildReemplazo(f, logo) {
  const bg='#99FF33', fbg='background:#DDEBF7;-webkit-print-color-adjust:exact;print-color-adjust:exact'
  return header(f,logo,'ORDEN DE TRABAJO - REEMPLAZO DE MEDIDOR EN CAMPO P 227 - ITEM 4')+
    '<table style="width:100%;border-collapse:collapse;font-size:8pt"><tr>'+
    th(bg,'2.4%','N\u00b0')+th(bg,'4.4%','OT')+th(bg,'7%','Semana')+th(bg,'12%','Fecha inicio trabajo')+th(bg,'12%','Fecha final trabajo')+
    th(bg,'17%','Fecha l\u00edmite entrega Expedientes (1), Reporte (2) y Actualizaci\u00f3n SIELSE (3)')+
    th(bg,'9%','Plazo de ejecuci\u00f3n (4)')+th(bg,'6%','Cantidad (5)')+th(bg,'12%','')+th(bg,'','Actividad (6)')+
    '</tr><tr>'+td('center','1')+td('center',f.ot)+td('center',f.sk)+td('center',f.t1)+td('center',f.t2)+td('center',f.t3)+td('center',f.pz)+td('center',f.cn)+td('left',f.mx)+td('left',f.ac)+
    '</tr></table>'+
    '<div style="font-size:7.5pt;margin:2px 0">Incluye reporte de expedientes, 6 fotograf\u00edas digitales, sustento de no ejecuci\u00f3n de reemplazo (Impreso a color 2 ejemplares, constancia oposici\u00f3n y/o constataci\u00f3n policial)</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">Reporte en formatos f\u00edsicos establecidos (todos los jueves hasta las 12:00 horas).</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">Actualizar en SIELSE al d\u00eda siguiente de ejecuci\u00f3n de Reemplazo, bajo responsabilidad como pasible a penalidades</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">En cumplimiento del Procedimiento N\u00b0 227-2013-OS/CD, realizar trabajo en el d\u00eda programado.</div>'+
    '<div style="font-size:7.5pt;margin:1px 0">Se debe notificar como m\u00ednimo 2 d\u00edas h\u00e1biles a la fecha programada (Aviso de Reemplazo de medidor)</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>IMPORTANTE:</b> Cumplimento estricto de las siguientes indicaciones.<br>- Informar puntualizando las observaciones encontradas m\u00e1ximo al d\u00eda siguiente de la fecha programada.<br>- Los <b>REEMPLAZOS DE MEDIDORES</b> se deben informar en el SIELSE, subir Fotograf\u00edas del antes y despu\u00e9s, <b>Expediente escaneado en PDF y subido al SIELSE (Aviso, acta de reemplazo y cert. verificaci\u00f3n).</b><br>- Reporte digital en archivo Excel enviado por correo en la fecha l\u00edmite de entrega.</div>'+
    '<div style="font-size:7.5pt;margin:3px 0"><b>Nota:</b> '+esc(f.cr)+' informar diariamente con evidencias fotogr\u00e1ficas en conformidad a los TDRs del contrato suscrito con EPU e informe t\u00e9cnico cada quincena del mes. La supervisi\u00f3n es muestral para llegar al indicador mensual.</div>'+
    '<table style="width:100%;border-collapse:collapse;margin-top:8px"><tr>'+
    '<td style="width:33%;'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">COORDINADOR &quot;'+esc(f.cr)+'&quot;</td>'+
    '<td style="width:34%;'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">\u00c1REA USUARIA - ELECTROPUNO S.A.A.</td>'+
    '<td style="'+fbg+';border:1px solid #000;padding:4px;font-size:8.5pt;font-weight:bold;text-align:center">COORDINADOR Y/O SUPERVISOR &quot;'+esc(f.co)+'&quot;</td>'+
    '</tr><tr><td style="border:1px solid #000;height:21mm"></td><td style="border:1px solid #000"></td><td style="border:1px solid #000"></td></tr></table>'
}

const CSS = '@page{size:279.4mm 215.9mm landscape;margin:16mm 14mm 20mm 12mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:9pt;color:#000}table{border-collapse:collapse;width:100%}'

export async function POST(request) {
  try {
    const body = await request.json()
    const { actividad, data: r } = body
    const logo = getLogo()
    const f = {
      ot: r.numero_ot||'', sk: r.codigo_ot||r.numero_ot||'',
      t1: fmtD(r.fecha_inicio), t2: fmtD(r.fecha_fin), t3: fmtD(r.fecha_limite),
      pz: r.dias_plazo||'1', cn: r.cantidad||'',
      ac: r.actividad_doc||r.actividad_label||'',
      te: fmtE(r.fecha_entrega),
      ct: (r.contrato||'').replace(/^Contrato\s+/i,''),
      cm: r.cumplimiento||'RESOLUCI\u00d3N N\u00b0 227-2013-OS/CD',
      av: r.actividad_label||'', ed: r.editado_por||'',
      cr: r.coordinador||'CONSORCIO SUPERVISOR',
      co: r.contratista_nombre||'', mx: r.motivo_extra||r.motivo_ot||'',
    }

    let body_html
    if (actividad==='Contraste'||actividad==='Contrastes') body_html=buildContrastes(f,logo)
    else if (actividad==='Avisos') body_html=buildAvisos(f,logo)
    else if (actividad==='Reemplazo') body_html=buildReemplazo(f,logo)
    else return NextResponse.json({error:'Actividad no soportada'},{status:400})

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+CSS+'</style></head><body>'+body_html+'<script>window.onload=function(){window.print()}<\/script></body></html>'

    // Intentar con puppeteer (Chrome local)
    let chromePath = null
    const os = await import('os')
    const candidates = [
      (await import('path')).default.join(os.default.homedir(),'AppData','Local','Google','Chrome','Application','chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
    ]
    for (const c of candidates) { try { if (fs.existsSync(c)) { chromePath = c; break } } catch {} }

    if (chromePath) {
      const puppeteer = (await import('puppeteer-core')).default
      const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] })
      const pg = await browser.newPage()
      await pg.setContent(html, { waitUntil: 'networkidle0' })
      const pdf = await pg.pdf({ width:'279.4mm', height:'215.9mm', printBackground:true, margin:{top:'16mm',right:'14mm',bottom:'20mm',left:'12mm'} })
      await browser.close()
      const filename = 'OT_'+f.ot+'_'+actividad+'.pdf'
      return new NextResponse(pdf, { status:200, headers:{ 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="'+filename+'"' } })
    }

    // Fallback: HTML para imprimir manualmente
    return new NextResponse(html, { status:200, headers:{'Content-Type':'text/html; charset=utf-8'} })
  } catch (err) {
    console.error('[genpdf]', err)
    return NextResponse.json({error: err.message},{status:500})
  }
}
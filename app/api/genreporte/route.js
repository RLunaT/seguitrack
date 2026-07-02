import { NextResponse } from 'next/server'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

export const maxDuration = 60

// ── Paleta del documento ──────────────────────────────────────
const C = {
  azul:       rgb(0.118, 0.302, 0.588),   // #1e4d96 azul corp
  azulOscuro: rgb(0.067, 0.188, 0.404),   // #113066
  azulSuave:  rgb(0.859, 0.902, 0.961),   // #dbe6f5 fondo header tabla
  grisClaro:  rgb(0.949, 0.953, 0.961),   // #f2f3f5 fila alternada
  grisBorde:  rgb(0.800, 0.816, 0.843),   // #ccd0d7
  grisTexto:  rgb(0.310, 0.333, 0.369),   // #4f5560
  negro:      rgb(0.110, 0.122, 0.149),   // #1c1f26
  blanco:     rgb(1, 1, 1),
  rojo:       rgb(0.784, 0.082, 0.082),   // #c81515
  verde:      rgb(0.086, 0.529, 0.200),   // #168733
  naranja:    rgb(0.800, 0.400, 0.000),   // #cc6600
  amarillo:   rgb(0.600, 0.480, 0.000),   // #997a00
  azulBadge:  rgb(0.118, 0.392, 0.745),   // #1e64be
}

const ESTADO = {
  1: { label: 'Cumplió a tiempo', color: C.verde    },
  2: { label: 'Cumplió tarde',    color: C.naranja   },
  3: { label: 'En proceso',       color: C.azulBadge },
  4: { label: 'Por vencer',       color: C.amarillo  },
  5: { label: 'Fuera de plazo',   color: C.rojo      },
  0: { label: 'Sin estado',       color: C.grisTexto },
}

const fmtFecha = f => f
  ? new Date(f + 'T00:00:00').toLocaleDateString('es-PE',
      { day:'2-digit', month:'2-digit', year:'numeric' })
  : '—'
const fmtNum = n => n != null ? Number(n).toLocaleString('es-PE') : '—'

function getCellText(ot, key) {
  switch (key) {
    case 'modulo':              return ot.modulo_nombre || '—'
    case 'contratista':         return ot.contratista_nombre || '—'
    case 'fecha_inicio':        return fmtFecha(ot.fecha_inicio)
    case 'fecha_fin_trabajos':  return fmtFecha(ot.fecha_fin_trabajos)
    case 'fecha_limite':        return fmtFecha(ot.fecha_limite)
    case 'cantidad_programada': return fmtNum(ot.cantidad_programada)
    case 'cantidad_entregada':  return fmtNum(ot.cantidad_entregada)
    case 'dias_fuera_plazo':    return (ot.dias_fuera_plazo || 0) > 0 ? `${ot.dias_fuera_plazo} días` : '—'
    case 'val_total_penalidad': return (ot.val_total_penalidad || 0) > 0
      ? `S/ ${Number(ot.val_total_penalidad).toLocaleString('es-PE',{minimumFractionDigits:2})}` : '—'
    case 'progreso':            return ot.progreso != null
      ? `${Math.round(ot.progreso * 100)}%` : '—'
    default:                    return String(ot[key] ?? '—')
  }
}

const COLS_META = {
  numero_ot:           { label: 'N° OT',         width: 42,  align: 'center' },
  modulo:              { label: 'Módulo',         width: 100, align: 'left'   },
  contratista:         { label: 'Contratista',    width: 125, align: 'left'   },
  actividad:           { label: 'Actividad',      width: 90,  align: 'left'   },
  semana:              { label: 'Semana',         width: 60,  align: 'center' },
  fecha_inicio:        { label: 'F. Inicio',      width: 72,  align: 'center' },
  fecha_fin_trabajos:  { label: 'F. Fin',         width: 72,  align: 'center' },
  fecha_limite:        { label: 'F. Límite Exp.', width: 80,  align: 'center' },
  cantidad_programada: { label: 'Cant. Prog.',    width: 60,  align: 'right'  },
  cantidad_entregada:  { label: 'Cant. Ent.',     width: 60,  align: 'right'  },
  dias_plazo:          { label: 'Plazo',          width: 44,  align: 'center' },
  duracion_real:       { label: 'Dur. Real',      width: 52,  align: 'center' },
  dias_fuera_plazo:    { label: 'Días Fuera',     width: 60,  align: 'center' },
  val_total_penalidad: { label: 'Penalidad',      width: 78,  align: 'right'  },
  estado:              { label: 'Estado',         width: 95,  align: 'center' },
  progreso:            { label: 'Progreso',       width: 52,  align: 'center' },
}

// Dibujar texto recortado con elipsis
function drawCell(page, text, x, y, maxW, font, size, color, align = 'left') {
  if (!text || text === '—') {
    if (text === '—') {
      const dw = font.widthOfTextAtSize('—', size)
      const dx = align === 'center' ? x + (maxW - dw) / 2 : align === 'right' ? x + maxW - dw - 4 : x + 4
      page.drawText('—', { x: dx, y, size, font, color: C.grisBorde })
    }
    return
  }
  let s = String(text)
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW - 8) s = s.slice(0, -1)
  if (s !== text && s.length > 2) s = s.slice(0, -1) + '…'
  const tw = font.widthOfTextAtSize(s, size)
  let dx = x + 4
  if (align === 'center') dx = x + (maxW - tw) / 2
  if (align === 'right')  dx = x + maxW - tw - 4
  page.drawText(s, { x: dx, y, size, font, color })
}

export async function POST(request) {
  try {
    const { titulo, subtitulo, filtros, columnas: colKeys, ots, agruparPor, totalesReporte } = await request.json()

    if (!ots?.length)
      return NextResponse.json({ error: 'Sin datos' }, { status: 400 })

    // ── Página A4 landscape ────────────────────────────────────
    const PW = 841.89
    const PH = 595.28
    const ML = 40   // margen izquierdo
    const MR = 40   // margen derecho
    const CW = PW - ML - MR  // 761.89

    // ── Columnas ───────────────────────────────────────────────
    const colsMeta = colKeys.map(k => ({ key: k, ...(COLS_META[k] || { label: k, width: 80, align: 'left' }) }))
    const totalW   = colsMeta.reduce((s, c) => s + c.width, 0)
    const scale    = totalW > CW ? CW / totalW : 1
    const cols     = colsMeta.map(c => ({ ...c, width: Math.floor(c.width * scale) }))

    // ── Crear PDF ──────────────────────────────────────────────
    const pdfDoc   = await PDFDocument.create()
    const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const fontItal = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

    let logoImg = null
    try {
      const lp = path.join(process.cwd(), 'public', 'logo_electropuno.jpg')
      if (fs.existsSync(lp)) logoImg = await pdfDoc.embedJpg(fs.readFileSync(lp))
    } catch (_) {}

    const hoy     = new Date()
    const fechaHoy = hoy.toLocaleDateString('es-PE', { day:'2-digit', month:'long', year:'numeric' })
    const horaHoy  = hoy.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })

    let pageNum   = 0
    let page      = null
    let yPos      = 0
    const MIN_Y   = 48   // zona del footer

    // ── Dibujar línea horizontal ───────────────────────────────
    const hLine = (p, y, x1 = ML, x2 = ML + CW, w = 0.5, color = C.grisBorde) =>
      p.drawLine({ start:{x:x1,y}, end:{x:x2,y}, thickness:w, color })

    // ── Nueva página ───────────────────────────────────────────
    function nuevaPagina(esPortada = false) {
      pageNum++
      page = pdfDoc.addPage([PW, PH])
      page.drawRectangle({ x:0, y:0, width:PW, height:PH, color:C.blanco })

      if (esPortada) {
        // ─────────────────────────────────────────────────────────
        // ENCABEZADO — 2 zonas:
        //   ZONA 1 (blanca, 54pt): logo grande a la izquierda +
        //          fecha/sistema a la derecha
        //   ZONA 2 (azul corp, 32pt): título del reporte centrado
        // ─────────────────────────────────────────────────────────

        // ZONA 1 — fondo blanco
        const Z1H = 54
        page.drawRectangle({ x:0, y:PH-Z1H, width:PW, height:Z1H, color:C.blanco })

        // Logo — más grande, bien centrado en la zona blanca
        if (logoImg) {
          const lw = 180, lh = 24
          page.drawImage(logoImg, { x:ML, y:PH-Z1H+(Z1H-lh)/2, width:lw, height:lh })
        } else {
          page.drawText('ELECTRO PUNO S.A.A.', { x:ML, y:PH-28, size:13, font:fontBold, color:C.azul })
          page.drawText('Empresa Regional de Servicio Público de Electricidad', { x:ML, y:PH-42, size:7.5, font:fontReg, color:C.grisTexto })
        }

        // Línea divisoria vertical suave antes de los datos de la derecha
        page.drawRectangle({ x:PW-200, y:PH-Z1H+10, width:0.5, height:Z1H-20, color:C.grisBorde })

        // Fecha y hora — zona derecha
        const rf  = `Puno, ${fechaHoy}`
        const rfW = fontBold.widthOfTextAtSize(rf, 8.5)
        page.drawText(rf, { x:PW-MR-rfW, y:PH-22, size:8.5, font:fontBold, color:C.negro })
        const rh  = `${horaHoy} hrs`
        const rhW = fontReg.widthOfTextAtSize(rh, 8)
        page.drawText(rh, { x:PW-MR-rhW, y:PH-34, size:8, font:fontReg, color:C.grisTexto })
        const sys  = 'SeguiTrack — Sistema de Seguimiento'
        const sysW = fontItal.widthOfTextAtSize(sys, 7.5)
        page.drawText(sys, { x:PW-MR-sysW, y:PH-46, size:7.5, font:fontItal, color:C.azul })

        // Línea inferior zona 1
        page.drawRectangle({ x:0, y:PH-Z1H, width:PW, height:1, color:C.grisBorde })

        // ZONA 2 — azul corporativo con título
        const Z2H = 32
        page.drawRectangle({ x:0, y:PH-Z1H-Z2H, width:PW, height:Z2H, color:C.azul })

        const tit  = titulo || 'Reporte de Órdenes de Trabajo'
        const titS = Math.min(13, 13)
        const titW = fontBold.widthOfTextAtSize(tit, titS)
        const titX = ML + (CW - Math.min(titW, CW)) / 2
        page.drawText(tit.length > 90 ? tit.slice(0,88)+'…' : tit, {
          x: titX, y: PH-Z1H-Z2H+(Z2H-titS)/2+2, size:titS, font:fontBold, color:C.blanco,
        })

        // Inicio del contenido
        yPos = PH - Z1H - Z2H - 18

        // Subtítulo (empresas/módulos seleccionados)
        if (subtitulo) {
          const stw = fontItal.widthOfTextAtSize(subtitulo, 9.5)
          page.drawText(subtitulo, { x:ML+(CW-Math.min(stw,CW))/2, y:yPos, size:9.5, font:fontItal, color:C.grisTexto })
          yPos -= 16
        }

        // ── Sección: filtros aplicados ───────────────────────────
        const filtrosActivos = Object.entries(filtros || {}).filter(([,v]) => v)
        if (filtrosActivos.length > 0) {
          yPos -= 6
          page.drawRectangle({ x:ML, y:yPos-12, width:CW, height:14, color:C.azulSuave })
          page.drawText('FILTROS APLICADOS', { x:ML+6, y:yPos-9, size:7.5, font:fontBold, color:C.azulOscuro })
          yPos -= 26

          let xf = ML
          const tagH = 14
          filtrosActivos.forEach(([k, v]) => {
            const lbl = {
              modulo:'Módulo', contratista:'Contratista', estado:'Estado',
              semana:'Semana', actividad:'Actividad', periodo:'Período',
              fechaDesde:'Desde', fechaHasta:'Hasta',
              conPenalidad:'Con penalidad', fueraPlazo:'Fuera de plazo',
            }[k] || k
            const txt  = `${lbl}: ${v}`
            const txw  = fontReg.widthOfTextAtSize(txt, 7.5) + 14
            if (xf + txw > ML + CW) { xf = ML; yPos -= tagH + 4 }
            page.drawRectangle({ x:xf, y:yPos-tagH+2, width:txw, height:tagH,
              color:C.blanco, borderColor:C.azul, borderWidth:0.75 })
            page.drawText(txt, { x:xf+7, y:yPos-8, size:7.5, font:fontReg, color:C.azulOscuro })
            xf += txw + 5
          })
          yPos -= tagH + 10
        }

        // ── Sección: totales globales ────────────────────────────
        if (totalesReporte) {
          yPos -= 6
          // Caja de resumen
          const boxH = 44
          page.drawRectangle({ x:ML, y:yPos-boxH, width:CW, height:boxH,
            color:C.blanco, borderColor:C.grisBorde, borderWidth:0.75 })
          // Borde izquierdo decorativo
          page.drawRectangle({ x:ML, y:yPos-boxH, width:4, height:boxH, color:C.azul })

          // Dato 1: OTs fuera de plazo
          const x1 = ML + 20
          page.drawText('OTs fuera de plazo', { x:x1, y:yPos-14, size:8, font:fontReg, color:C.grisTexto })
          page.drawText(String(totalesReporte.fueraPlazo), { x:x1, y:yPos-34, size:22, font:fontBold, color:C.rojo })
          page.drawText('en la selección actual', { x:x1 + fontBold.widthOfTextAtSize(String(totalesReporte.fueraPlazo), 22) + 6,
            y:yPos-36, size:7.5, font:fontItal, color:C.grisTexto })

          // Separador vertical
          page.drawLine({ start:{x:ML+200, y:yPos-8}, end:{x:ML+200, y:yPos-boxH+8}, thickness:0.75, color:C.grisBorde })

          // Dato 2: Penalidad total
          const x2 = ML + 214
          page.drawText('Penalidad total acumulada', { x:x2, y:yPos-14, size:8, font:fontReg, color:C.grisTexto })
          const penStr = `S/ ${Number(totalesReporte.penalidad).toLocaleString('es-PE',{minimumFractionDigits:2})}`
          page.drawText(penStr, { x:x2, y:yPos-34, size:19, font:fontBold, color:C.rojo })
          page.drawText('suma de penalidades en la selección', { x:x2 + fontBold.widthOfTextAtSize(penStr, 19) + 6,
            y:yPos-36, size:7.5, font:fontItal, color:C.grisTexto })

          yPos -= boxH + 16
        }

        // ── Nota sobre el reporte ────────────────────────────────
        hLine(page, yPos, ML, ML+CW, 0.5)
        yPos -= 14
        const nota = `Este informe fue generado automáticamente por el sistema de seguimiento y control de órdenes de trabajo (SeguiTrack) en base a los datos registrados al ${fechaHoy}. Contiene ${ots.length} orden${ots.length !== 1 ? 'es' : ''} de trabajo${Object.entries(filtros||{}).filter(([,v])=>v).length > 0 ? ' según los filtros indicados' : ' en total'}.`
        page.drawText(nota, { x:ML, y:yPos, size:7.5, font:fontItal, color:C.grisTexto })
        yPos -= 22

        // ── Encabezado de tabla ──────────────────────────────────
        return
      }

      // ── Páginas siguientes: header compacto en 2 zonas ─────────
      // Zona blanca: logo + info derecha
      page.drawRectangle({ x:0, y:PH-28, width:PW, height:28, color:C.blanco })
      if (logoImg) {
        page.drawImage(logoImg, { x:ML, y:PH-24, width:110, height:15 })
      } else {
        page.drawText('ELECTRO PUNO S.A.A.', { x:ML, y:PH-18, size:9, font:fontBold, color:C.azul })
      }
      // Título del reporte centrado en blanco
      const ptit  = titulo || 'Reporte de Órdenes de Trabajo'
      const ptitW = fontBold.widthOfTextAtSize(ptit, 9)
      page.drawText(ptit, { x:(PW-ptitW)/2, y:PH-18, size:9, font:fontBold, color:C.negro })
      // Pág. y fecha a la derecha
      const pinfo  = `Pág. ${pageNum}  ·  ${fechaHoy}`
      const pinfoW = fontReg.widthOfTextAtSize(pinfo, 7.5)
      page.drawText(pinfo, { x:PW-MR-pinfoW, y:PH-18, size:7.5, font:fontReg, color:C.grisTexto })
      // Línea azul inferior del header
      page.drawRectangle({ x:0, y:PH-28, width:PW, height:2, color:C.azul })

      yPos = PH - 44
    }

    // ── Footer de cada página ──────────────────────────────────
    function dibujarFooter(p, num, total) {
      hLine(p, 36, ML, ML+CW, 0.5)
      p.drawText('Electro Puno S.A.A.  ·  Área de Normalización de Conexiones  ·  Documento generado por SeguiTrack',
        { x:ML, y:22, size:7, font:fontReg, color:C.grisTexto })
      const pn = `Página ${num} de ${total}`
      const pnW = fontReg.widthOfTextAtSize(pn, 7)
      p.drawText(pn, { x:PW-MR-pnW, y:22, size:7, font:fontReg, color:C.grisTexto })
      hLine(p, 14, ML, ML+CW, 1.5, C.azul)
    }

    // ── Encabezado de tabla ────────────────────────────────────
    const ROW_H    = 16
    const HEAD_H   = 20

    function dibujarEncabezadoTabla() {
      page.drawRectangle({ x:ML, y:yPos-HEAD_H, width:CW, height:HEAD_H, color:C.azul })
      let xc = ML
      cols.forEach(col => {
        const lw = fontBold.widthOfTextAtSize(col.label, 7.5)
        let lx = xc + 4
        if (col.align === 'center') lx = xc + (col.width - lw) / 2
        if (col.align === 'right')  lx = xc + col.width - lw - 4
        page.drawText(col.label, { x:lx, y:yPos-13, size:7.5, font:fontBold, color:C.blanco })
        if (xc > ML) page.drawLine({ start:{x:xc,y:yPos-2}, end:{x:xc,y:yPos-HEAD_H+2}, thickness:0.5, color:rgb(0.5,0.65,0.9) })
        xc += col.width
      })
      yPos -= HEAD_H
    }

    // ── Agrupar si aplica ──────────────────────────────────────
    let itemsToRender = []
    if (agruparPor) {
      const grupos = {}
      ots.forEach(ot => {
        const k = agruparPor === 'modulo'      ? (ot.modulo_nombre || '—')
                : agruparPor === 'contratista' ? (ot.contratista_nombre || '—')
                : agruparPor === 'estado'      ? (ESTADO[ot.estado]?.label || 'Sin estado')
                : agruparPor === 'semana'      ? (ot.semana || 'Sin semana')
                : '—'
        if (!grupos[k]) grupos[k] = []
        grupos[k].push(ot)
      })
      Object.entries(grupos).forEach(([g, items]) => {
        itemsToRender.push({ _grupo:g, _count:items.length })
        items.forEach(ot => itemsToRender.push(ot))
      })
    } else {
      itemsToRender = ots
    }

    // ── Generar páginas ────────────────────────────────────────
    nuevaPagina(true)

    // Título de tabla
    page.drawText('DETALLE DE ÓRDENES DE TRABAJO', { x:ML, y:yPos, size:8, font:fontBold, color:C.azulOscuro })
    hLine(page, yPos-4, ML, ML+CW, 1, C.azul)
    yPos -= 16
    dibujarEncabezadoTabla()

    let rowI = 0
    for (const item of itemsToRender) {
      // ¿Necesita nueva página?
      const needH = item._grupo !== undefined ? ROW_H + 4 : ROW_H
      if (yPos - needH < MIN_Y) {
        nuevaPagina(false)
        dibujarEncabezadoTabla()
        rowI = 0
      }

      // Fila de grupo
      if (item._grupo !== undefined) {
        yPos -= 4
        page.drawRectangle({ x:ML, y:yPos-ROW_H, width:CW, height:ROW_H, color:C.azulSuave })
        page.drawRectangle({ x:ML, y:yPos-ROW_H, width:3, height:ROW_H, color:C.azul })
        page.drawText(`${item._grupo}`, { x:ML+10, y:yPos-12, size:8, font:fontBold, color:C.azulOscuro })
        const cnt = `${item._count} OT${item._count !== 1 ? 's' : ''}`
        const cntW = fontReg.widthOfTextAtSize(cnt, 7.5)
        page.drawText(cnt, { x:ML+CW-cntW-8, y:yPos-12, size:7.5, font:fontReg, color:C.grisTexto })
        hLine(page, yPos-ROW_H, ML, ML+CW, 0.5, C.azulSuave)
        yPos -= ROW_H
        rowI = 0
        continue
      }

      // Fila de datos
      const bg = rowI % 2 === 0 ? C.blanco : C.grisClaro
      page.drawRectangle({ x:ML, y:yPos-ROW_H, width:CW, height:ROW_H, color:bg })

      let xc = ML
      cols.forEach(col => {
        // Separador vertical de columna
        if (xc > ML) {
          page.drawLine({ start:{x:xc,y:yPos}, end:{x:xc,y:yPos-ROW_H}, thickness:0.4, color:C.grisBorde })
        }

        if (col.key === 'estado') {
          const ei = ESTADO[item.estado] || ESTADO[0]
          const lbl = ei.label
          const lw  = fontBold.widthOfTextAtSize(lbl, 6.5)
          const bx  = xc + (col.width - lw) / 2
          page.drawText(lbl, { x:bx, y:yPos-12, size:6.5, font:fontBold, color:ei.color })
        } else {
          const txt = getCellText(item, col.key)
          // Resaltar dias_fuera_plazo si > 0
          const color = (col.key === 'dias_fuera_plazo' && (item.dias_fuera_plazo || 0) > 0) ? C.rojo
                      : (col.key === 'val_total_penalidad' && (item.val_total_penalidad || 0) > 0) ? C.rojo
                      : C.negro
          const font  = (col.key === 'numero_ot') ? fontBold : fontReg
          drawCell(page, txt, xc, yPos-12, col.width, font, 7.5, color, col.align)
        }
        xc += col.width
      })

      // Borde inferior de fila
      hLine(page, yPos-ROW_H, ML, ML+CW, 0.4, C.grisBorde)
      yPos -= ROW_H
      rowI++
    }

    // Borde final de tabla
    page.drawRectangle({ x:ML, y:yPos-1, width:CW, height:1.5, color:C.azul })

    // ── Agregar footers ────────────────────────────────────────
    const allPages = pdfDoc.getPages()
    allPages.forEach((p, i) => dibujarFooter(p, i+1, allPages.length))

    // ── Serializar ─────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save()
    const fname    = `Reporte_OTs_${new Date().toISOString().slice(0,10)}.pdf`

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${fname}"`,
      },
    })
  } catch (err) {
    console.error('[genreporte]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
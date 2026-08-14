import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const maxDuration = 60

// ── Misma paleta que el PDF (app/api/genreporte/route.js) ──────────────
const C = {
  azul:       'FF1E4D96',
  azulOscuro: 'FF113066',
  azulSuave:  'FFDBE6F5',
  grisClaro:  'FFF2F3F5',
  grisBorde:  'FFCCD0D7',
  grisTexto:  'FF4F5560',
  negro:      'FF1C1F26',
  blanco:     'FFFFFFFF',
  rojo:       'FFC81515',
  rojoFondo:  'FFFBE9E9',
  verde:      'FF168733',
  verdeFondo: 'FFE9F7ED',
  naranja:    'FFCC6600',
  naranjaFondo: 'FFFCF0E0',
  amarillo:   'FF997A00',
  amarilloFondo: 'FFFDF6DC',
  azulBadge:  'FF1E64BE',
  azulBadgeFondo: 'FFE6EFFA',
}

const ESTADO = {
  1: { label: 'Cumplió a tiempo', color: C.verde,    fondo: C.verdeFondo },
  2: { label: 'Cumplió tarde',    color: C.naranja,  fondo: C.naranjaFondo },
  3: { label: 'En proceso',       color: C.azulBadge,fondo: C.azulBadgeFondo },
  4: { label: 'Por vencer',       color: C.amarillo, fondo: C.amarilloFondo },
  5: { label: 'Fuera de plazo',   color: C.rojo,     fondo: C.rojoFondo },
  0: { label: 'Sin estado',       color: C.grisTexto,fondo: C.grisClaro },
}

const COLS_META = {
  numero_ot:              { label: 'N° OT',            width: 10, align: 'center' },
  modulo:                 { label: 'Módulo',            width: 22, align: 'left'   },
  contratista:            { label: 'Contratista',       width: 28, align: 'left'   },
  contrato:               { label: 'N° Contrato',       width: 24, align: 'left'   },
  actividad:              { label: 'Actividad',         width: 16, align: 'left'   },
  motivo_ot:              { label: 'Motivo',            width: 14, align: 'center' },
  periodo:                { label: 'Período',           width: 10, align: 'center' },
  semana:                 { label: 'Semana',            width: 12, align: 'center' },
  fecha_entrega_ot:       { label: 'F. Entrega OT',     width: 14, align: 'center' },
  cantidad_programada:    { label: 'Cant. Prog.',       width: 12, align: 'right'  },
  cantidad_entregada:     { label: 'Cant. Ent.',        width: 12, align: 'right'  },
  progreso:               { label: 'Progreso',          width: 10, align: 'center' },
  observaciones:          { label: 'Observaciones',     width: 30, align: 'left'   },
  eficiencia:             { label: 'Eficiencia',        width: 10, align: 'center' },
}
// Columnas requeridas para que las fórmulas funcionen — siempre visibles,
// se agregan al final si el usuario no las eligió explícitamente.
const COLS_CALCULO = {
  fecha_inicio:           { label: 'F. Inicio',          width: 13, align: 'center', tipo:'fecha' },
  fecha_limite:           { label: 'F. Límite Exp.',     width: 14, align: 'center', tipo:'fecha' },
  fecha_reporte:          { label: 'F. Reporte',         width: 13, align: 'center', tipo:'fecha' },
  tasa_penalidad:         { label: 'Tasa Penalidad (S//día)', width: 16, align: 'right', tipo:'num' },
  val_penalidades_manual: { label: 'Penalidad Manual',   width: 14, align: 'right', tipo:'moneda' },
  dias_plazo:             { label: 'Plazo (días)',       width: 12, align: 'center', tipo:'num', formula:true },
  duracion_real:          { label: 'Duración Real',      width: 12, align: 'center', tipo:'num', formula:true },
  dias_fuera_plazo:       { label: 'Días Fuera Plazo',   width: 13, align: 'center', tipo:'num', formula:true },
  val_total_penalidad:    { label: 'Penalidad Total',    width: 15, align: 'right', tipo:'moneda', formula:true },
  estado:                 { label: 'Estado',             width: 16, align: 'center' },
}

const fmtFecha = f => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}) : null

function getCellText(ot, key) {
  switch (key) {
    case 'modulo':                 return ot.modulo_nombre || '—'
    case 'contratista':            return ot.contratista_nombre || '—'
    case 'contrato':               return ot.contrato || '—'
    case 'motivo_ot':              return ot.motivo_ot || '—'
    case 'periodo':                return ot.periodo || '—'
    case 'cantidad_programada':    return ot.cantidad_programada ?? null
    case 'cantidad_entregada':     return ot.cantidad_entregada ?? null
    case 'progreso':               return ot.progreso != null ? Math.round(ot.progreso*100)/100 : null
    case 'eficiencia':             return ot.eficiencia != null ? Math.round((ot.eficiencia||0)*10000)/100 : null
    case 'observaciones':          return ot.observaciones ? String(ot.observaciones).slice(0,300) : ''
    default:                       return ot[key] ?? '—'
  }
}

export async function POST(request) {
  try {
    const { titulo, subtitulo, filtros, columnas: colKeysIn, ots } = await request.json()
    if (!ots?.length)
      return NextResponse.json({ error: 'No hay órdenes de trabajo para generar el reporte.' }, { status: 400 })

    // Columnas elegidas por el usuario + las de cálculo que falten (sin duplicar)
    const colKeys = [...colKeysIn]
    Object.keys(COLS_CALCULO).forEach(k => { if (!colKeys.includes(k)) colKeys.push(k) })
    const cols = colKeys.map(k => ({ key: k, ...(COLS_META[k] || COLS_CALCULO[k] || { label: k, width: 14, align: 'left' }) }))
    const nCalculoDesde = cols.findIndex(c => Object.keys(COLS_CALCULO).includes(c.key))

    const wb = new ExcelJS.Workbook()
    wb.creator = 'SeguiTrack'
    const ws = wb.addWorksheet('Reporte', { views: [{ showGridLines: false }] })

    const nCols = cols.length
    ws.columns = cols.map(c => ({ width: c.width }))

    let r = 1
    // ── Título ───────────────────────────────────────────────────
    ws.mergeCells(r, 1, r, nCols)
    const cTitulo = ws.getCell(r, 1)
    cTitulo.value = 'ELECTRO PUNO S.A.A. — ' + (titulo || 'Reporte de Órdenes de Trabajo')
    cTitulo.font = { bold: true, size: 14, color: { argb: C.blanco } }
    cTitulo.alignment = { horizontal: 'center', vertical: 'middle' }
    cTitulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.azul } }
    ws.getRow(r).height = 26
    r++

    if (subtitulo) {
      ws.mergeCells(r, 1, r, nCols)
      const cSub = ws.getCell(r, 1)
      cSub.value = subtitulo
      cSub.font = { italic: true, size: 10, color: { argb: C.grisTexto } }
      cSub.alignment = { horizontal: 'center' }
      r++
    }
    const hoy = new Date()
    ws.mergeCells(r, 1, r, nCols)
    const cFecha = ws.getCell(r, 1)
    cFecha.value = `Puno, ${hoy.toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})} — ${hoy.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})} hrs`
    cFecha.font = { size: 8.5, color: { argb: C.grisTexto } }
    cFecha.alignment = { horizontal: 'center' }
    r += 2

    // ── Filtros aplicados ───────────────────────────────────────
    const filtrosActivos = Object.entries(filtros || {}).filter(([,v]) => v)
    if (filtrosActivos.length > 0) {
      const lbl = { periodo:'Período', modulo:'Módulo', contratista:'Contratista', estado:'Estado', semana:'Semana', actividad:'Actividad', fechaDesde:'Desde', fechaHasta:'Hasta' }
      ws.mergeCells(r, 1, r, nCols)
      const cF = ws.getCell(r, 1)
      cF.value = 'FILTROS APLICADOS: ' + filtrosActivos.map(([k,v]) => `${lbl[k]||k}: ${v}`).join('   ·   ')
      cF.font = { bold: true, size: 8.5, color: { argb: C.azulOscuro } }
      cF.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.azulSuave } }
      cF.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      ws.getRow(r).height = 16
      r += 2
    }

    // ── Caja de totales (se llena con fórmulas más abajo, referencias) ──
    const rTotalesResumen = r
    const etiquetas = ['Total OTs', 'Cumplidas', 'Fuera de plazo', 'Penalidad Total (S/)']
    const anchoCelda = Math.max(1, Math.floor(nCols/4))
    etiquetas.forEach((et, i) => {
      const c0 = i*anchoCelda+1
      const c1 = i===3 ? nCols : Math.min(nCols, (i+1)*anchoCelda)
      ws.mergeCells(r, c0, r, c1)
      const cell = ws.getCell(r, c0)
      cell.value = et
      cell.font = { bold: true, size: 8, color: { argb: C.grisTexto } }
      cell.alignment = { horizontal: 'center' }
      cell.border = { top:{style:'thin',color:{argb:C.grisBorde}}, left:{style:'thin',color:{argb:C.grisBorde}} }
    })
    r++
    const rTotalesValor = r
    etiquetas.forEach((et, i) => {
      const c0 = i*anchoCelda+1
      const c1 = i===3 ? nCols : Math.min(nCols, (i+1)*anchoCelda)
      ws.mergeCells(r, c0, r, c1)
      const cell = ws.getCell(r, c0)
      cell.font = { bold: true, size: 13, color: { argb: i===2?C.rojo:i===3?C.naranja:C.azul } }
      cell.alignment = { horizontal: 'center' }
      cell.border = { bottom:{style:'thin',color:{argb:C.grisBorde}}, left:{style:'thin',color:{argb:C.grisBorde}} }
    })
    r += 2

    // ── Encabezado de tabla ──────────────────────────────────────
    const rHeader = r
    cols.forEach((c, i) => {
      const cell = ws.getCell(rHeader, i+1)
      cell.value = c.label
      cell.font = { bold: true, size: 9, color: { argb: C.blanco } }
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb: C.azul } }
      cell.alignment = { horizontal: c.align==='right'?'right':c.align==='center'?'center':'left', vertical:'middle', wrapText:true }
      cell.border = { top:{style:'thin',color:{argb:C.azul}}, bottom:{style:'thin',color:{argb:C.azul}} }
    })
    ws.getRow(rHeader).height = 24
    ws.views = [{ state: 'frozen', ySplit: rHeader }]
    r++
    const rPrimeraDato = r

    // ── Filas de datos ────────────────────────────────────────────
    ots.forEach((ot, i) => {
      const fila = r
      const zebra = i % 2 === 1
      cols.forEach((c, ci) => {
        const cell = ws.getCell(fila, ci+1)
        cell.border = { bottom:{style:'hair',color:{argb:C.grisBorde}} }
        if (zebra) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:C.grisClaro} }
        cell.alignment = { horizontal: c.align==='right'?'right':c.align==='center'?'center':'left', vertical:'middle' }
        cell.font = { size: 9, color: { argb: C.negro } }

        if (c.key === 'estado') {
          const e = ESTADO[ot.estado] || ESTADO[0]
          cell.value = e.label
          cell.font = { size: 9, bold: true, color: { argb: e.color } }
          cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:e.fondo} }
          return
        }
        if (['fecha_inicio','fecha_limite','fecha_reporte','fecha_entrega_ot'].includes(c.key)) {
          const raw = c.key==='fecha_entrega_ot' ? ot.datos_extra?.doc_fecha_entrega
            : c.key==='fecha_limite' ? ot.fecha_limite_expedientes : ot[c.key]
          cell.value = raw ? new Date(raw + 'T00:00:00') : null
          cell.numFmt = 'dd/mm/yyyy'
          return
        }
        if (c.key === 'tasa_penalidad') { cell.value = ot._tasa_penalidad || 0; cell.numFmt = '#,##0.00'; return }
        if (c.key === 'val_penalidades_manual') { cell.value = ot.val_penalidades_manual || 0; cell.numFmt = '"S/" #,##0.00'; return }
        if (['dias_plazo','duracion_real','dias_fuera_plazo','val_total_penalidad'].includes(c.key)) return // fórmula, más abajo

        cell.value = getCellText(ot, c.key)
      })
      r++
    })
    const rUltimoDato = r - 1

    // ── Fórmulas por fila (después de escribir valores, para referenciar letras de columna) ──
    const colLetraDe = key => {
      const idx = cols.findIndex(c => c.key === key)
      return idx >= 0 ? ws.getColumn(idx+1).letter : null
    }
    const [cFI, cFL, cFR, cTasa, cManual, cPlazo, cDur, cFuera, cTotal] =
      ['fecha_inicio','fecha_limite','fecha_reporte','tasa_penalidad','val_penalidades_manual','dias_plazo','duracion_real','dias_fuera_plazo','val_total_penalidad'].map(colLetraDe)

    for (let fila = rPrimeraDato; fila <= rUltimoDato; fila++) {
      const fPlazo = `IF(AND(${cFI}${fila}<>"",${cFL}${fila}<>""),${cFL}${fila}-${cFI}${fila}+1,"")`
      const fDur   = `IF(${cFR}${fila}<>"",${cFR}${fila}-${cFI}${fila}+1,IF(AND(${cFI}${fila}<>"",${cFL}${fila}<>"",TODAY()>${cFL}${fila}),TODAY()-${cFI}${fila}+1,""))`
      const fFuera = `IF(AND(${cPlazo}${fila}<>"",${cDur}${fila}<>""),MAX(0,${cDur}${fila}-${cPlazo}${fila}),0)`
      const fTotal = `${cFuera}${fila}*${cTasa}${fila}+${cManual}${fila}`

      const cellPlazo = ws.getCell(`${cPlazo}${fila}`); cellPlazo.value = { formula: fPlazo }; cellPlazo.numFmt='0'
      const cellDur   = ws.getCell(`${cDur}${fila}`);   cellDur.value   = { formula: fDur };   cellDur.numFmt='0'
      const cellFuera = ws.getCell(`${cFuera}${fila}`); cellFuera.value = { formula: fFuera }; cellFuera.numFmt='0'
      const cellTotal = ws.getCell(`${cTotal}${fila}`); cellTotal.value = { formula: fTotal }; cellTotal.numFmt='"S/" #,##0.00'
      // Vuelve a poner alineación/fuente porque .value la resetea
      ;[cellPlazo,cellDur,cellFuera].forEach(c=>{c.alignment={horizontal:'center'};c.font={size:9,color:{argb:C.negro}}})
      cellTotal.alignment = { horizontal:'right' }; cellTotal.font = { size:9, bold:true, color:{argb:C.naranja} }
      const zebra = (fila - rPrimeraDato) % 2 === 1
      if (zebra) [cellPlazo,cellDur,cellFuera,cellTotal].forEach(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:C.grisClaro}}})
    }

    // ── Totales del resumen (arriba) — fórmulas sobre el rango de datos ──
    ws.getCell(rTotalesValor, 1).value = ots.length
    ws.getCell(rTotalesValor, Math.floor(nCols/4)+1).value = { formula: `COUNTIF(${cFuera}${rPrimeraDato}:${cFuera}${rUltimoDato},0)-COUNTIF(${cFuera}${rPrimeraDato}:${cFuera}${rUltimoDato},"")` }
    ws.getCell(rTotalesValor, 2*Math.floor(nCols/4)+1).value = { formula: `COUNTIF(${cFuera}${rPrimeraDato}:${cFuera}${rUltimoDato},">0")` }
    const cTotalCell = ws.getCell(rTotalesValor, 3*Math.floor(nCols/4)+1)
    cTotalCell.value = { formula: `SUM(${cTotal}${rPrimeraDato}:${cTotal}${rUltimoDato})` }
    cTotalCell.numFmt = '"S/" #,##0.00'

    // ── Fila TOTALES al pie de la tabla ───────────────────────────
    r = rUltimoDato + 1
    ws.mergeCells(r, 1, r, nCols - 1)
    const cLbl = ws.getCell(r, 1)
    cLbl.value = 'TOTALES'
    cLbl.font = { bold: true, size: 9, color: { argb: C.blanco } }
    cLbl.fill = { type:'pattern', pattern:'solid', fgColor:{argb:C.azul} }
    cLbl.alignment = { horizontal: 'right', vertical:'middle' }
    const cPie = ws.getCell(r, nCols)
    cPie.value = { formula: `SUM(${cTotal}${rPrimeraDato}:${cTotal}${rUltimoDato})` }
    cPie.numFmt = '"S/" #,##0.00'
    cPie.font = { bold: true, size: 9, color: { argb: C.blanco } }
    cPie.fill = { type:'pattern', pattern:'solid', fgColor:{argb:C.azul} }
    cPie.alignment = { horizontal:'right', vertical:'middle' }
    ws.getRow(r).height = 20

    // Nota sobre columnas de cálculo agregadas al final
    if (nCalculoDesde >= 0 && nCalculoDesde < colKeysIn.length + Object.keys(COLS_CALCULO).length) {
      r += 2
      ws.mergeCells(r, 1, r, nCols)
      const cNota = ws.getCell(r, 1)
      cNota.value = '* Las columnas de fecha, tasa y penalidad manual (al final) son datos de apoyo para que las fórmulas de Plazo, Duración, Días Fuera y Penalidad Total funcionen. Si editas una fecha, todo se recalcula solo.'
      cNota.font = { italic: true, size: 8, color: { argb: C.grisTexto } }
      cNota.alignment = { wrapText: true }
    }

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Reporte_OTs_${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 })
  }
}
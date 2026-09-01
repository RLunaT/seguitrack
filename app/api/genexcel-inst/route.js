import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const maxDuration = 60

// ── Colores ─────────────────────────────────────────────────────
const C = {
  azulOsc:     'FF0F2844',
  azulMed:     'FF1B4F8A',
  azulFact:    'FFDBEAFE',  // fondo filas Factibilidades
  moradoInst:  'FFEDE9FE',  // fondo filas Instalaciones
  azulTexto:   'FF1E3A5F',
  moradoTexto: 'FF2E1065',
  azulAct:     'FF0369A1',
  moradoAct:   'FF6D28D9',
  grisBorde:   'FFCBD5E1',
  grisH:       'FF1E293B',
  blanco:      'FFFFFFFF',
  grisTexto:   'FF94A3B8',
  verde:       'FF065F46',
  verdeFondo:  'FFD1FAE5',
  naranja:     'FFCC6600',
  naranjaFondo:'FFFCF0E0',
  rojo:        'FFC81515',
  rojoFondo:   'FFFBE9E9',
  azulBadge:   'FF1E64BE',
  azulBadgeFondo: 'FFE6EFFA',
  amarillo:    'FF997A00',
  amarilloFondo: 'FFFDF6DC',
}

const ESTADO_LABEL = {
  1: { label: 'Cumplió a tiempo', color: C.verde,     fondo: C.verdeFondo },
  2: { label: 'Cumplió tarde',    color: C.naranja,   fondo: C.naranjaFondo },
  3: { label: 'En proceso',       color: C.azulBadge, fondo: C.azulBadgeFondo },
  4: { label: 'Por vencer',       color: C.amarillo,  fondo: C.amarilloFondo },
  5: { label: 'Fuera de plazo',   color: C.rojo,      fondo: C.rojoFondo },
}

function fill(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } } }
function border() {
  const s = { style: 'thin', color: { argb: C.grisBorde } }
  return { left: s, right: s, top: s, bottom: s }
}
function fmtFecha(v) {
  if (!v) return ''
  const d = new Date(v + 'T00:00:00')
  const DIAS = ['do','lu','ma','mi','ju','vi','sá']
  return `${DIAS[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export async function POST(req) {
  try {
    const { ots, contratistas, modulo, anio, camposExtra = [] } = await req.json()

    // Agrupar OTs por numero_ot — cada grupo tiene fact e inst
    const grupos = {}
    for (const ot of ots) {
      const key = ot.numero_ot
      if (!grupos[key]) grupos[key] = { fact: null, inst: null }
      if (ot.actividad === 'factibilidades') grupos[key].fact = ot
      else if (ot.actividad === 'instalaciones') grupos[key].inst = ot
    }
    const gruposOrdenados = Object.entries(grupos).sort(([a],[b]) => Number(a) - Number(b))

    const wb = new ExcelJS.Workbook()
    wb.creator = 'SeguiTrack'
    wb.created = new Date()

    const ws = wb.addWorksheet(`Inst. Nuevas ${anio || ''}`, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    })

    // ── Columnas fijas — mismo orden que CAMPOS_BASE del módulo ─
    const colsFijas = [
      { key: 'numero_ot',    label: 'N° OT',           width: 8,  align: 'center' },
      { key: 'contratista',  label: 'Contratista',      width: 26, align: 'left'   },
      { key: 'contrato',     label: 'N° Contrato',      width: 18, align: 'left'   },
      { key: 'detalle',      label: 'Detalle OT',       width: 32, align: 'left'   },
      { key: 'actividad',    label: 'Actividad',        width: 18, align: 'center' },
      { key: 'fecha_entrega',label: 'F. Entrega OT',    width: 14, align: 'center' },
      { key: 'fi',           label: 'F. Inicio',        width: 14, align: 'center' },
      { key: 'ff',           label: 'F. Final',         width: 14, align: 'center' },
      { key: 'fl',           label: 'F. Límite Exp.',   width: 14, align: 'center' },
      { key: 'plazo',        label: 'Plazo',            width: 9,  align: 'center' },
      { key: 'cant_prog',    label: 'Cant. Prog.',      width: 10, align: 'center' },
      { key: 'fecha_rep',    label: 'F. Reporte',       width: 14, align: 'center' },
      { key: 'cant_ent',     label: 'Cant. Ent.',       width: 10, align: 'center' },
      { key: 'estado',       label: 'Estado',           width: 16, align: 'center' },
      { key: 'dur_real',     label: 'Dur. Real',        width: 10, align: 'center' },
      { key: 'd_fuera',      label: 'D. Fuera',         width: 10, align: 'center' },
      { key: 'val_pen',      label: 'Val. Pen.',        width: 12, align: 'right'  },
      { key: 'val_total',    label: 'Val. Total',       width: 12, align: 'right'  },
      { key: 'obs',          label: 'Observaciones',    width: 28, align: 'left'   },
    ]

    // Columnas extra (campos personalizados del módulo)
    const colsExtra = camposExtra.map(c => ({
      key:   `extra_${c.clave}`,
      label: c.nombre,
      width: 16,
      align: 'left',
    }))

    const todasCols = [...colsFijas, ...colsExtra]
    const nCols = todasCols.length

    ws.columns = todasCols.map(c => ({
      key: c.key, width: c.width
    }))

    // ── Fila 1: Título ───────────────────────────────────────────
    ws.mergeCells(1, 1, 1, nCols)
    const tCell = ws.getCell(1, 1)
    tCell.value = `FACTIBILIDADES E INSTALACIONES NUEVAS · AÑO ${anio || ''} · ${modulo?.nombre || 'Instalaciones Nuevas'}`
    tCell.font  = { name: 'Arial', bold: true, size: 13, color: { argb: C.blanco } }
    tCell.fill  = fill(C.azulOsc)
    tCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 28

    // ── Fila 2: Info exportación ─────────────────────────────────
    ws.mergeCells(2, 1, 2, Math.floor(nCols / 2))
    const i1 = ws.getCell(2, 1)
    i1.value = `Total OTs: ${gruposOrdenados.length}  ·  Exportado: ${new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}`
    i1.font  = { name: 'Arial', size: 9, color: { argb: C.grisTexto } }
    i1.fill  = fill(C.grisH)
    i1.alignment = { horizontal: 'left', vertical: 'middle' }

    ws.mergeCells(2, Math.floor(nCols/2)+1, 2, nCols)
    const i2 = ws.getCell(2, Math.floor(nCols/2)+1)
    i2.value = `Contrato: ${ots[0]?.contrato || ''}`
    i2.font  = { name: 'Arial', size: 9, color: { argb: C.grisTexto } }
    i2.fill  = fill(C.grisH)
    i2.alignment = { horizontal: 'right', vertical: 'middle' }
    ws.getRow(2).height = 18

    // ── Fila 3: Encabezados ──────────────────────────────────────
    const hRow = ws.getRow(3)
    hRow.height = 30
    todasCols.forEach((c, i) => {
      const cell = hRow.getCell(i + 1)
      cell.value = c.label
      cell.font  = { name: 'Arial', bold: true, size: 10, color: { argb: C.blanco } }
      cell.fill  = fill(C.azulMed)
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = border()
    })

    // ── Datos ────────────────────────────────────────────────────
    let rowIdx = 4
    for (const [numero_ot, { fact, inst }] of gruposOrdenados) {
      const contNombre = contratistas?.find(c => c.id === (fact || inst)?.contratista_id)?.nombre || ''

      // Para cada actividad (fact, inst)
      for (const [esFirst, ot, esF] of [
        [true,  fact, true ],
        [false, inst, false],
      ]) {
        if (!ot) continue
        const bgArgb = esF ? C.azulFact : C.moradoInst
        const fgArgb = esF ? C.azulTexto : C.moradoTexto
        const actColor = esF ? C.azulAct : C.moradoAct

        // Plazo días calendario
        const plazo = ot.fecha_inicio && ot.fecha_fin_trabajos
          ? (() => {
              const d1 = new Date(ot.fecha_inicio + 'T00:00:00')
              const d2 = new Date(ot.fecha_fin_trabajos + 'T00:00:00')
              return `${Math.round((d2-d1)/86400000)+1} días`
            })()
          : ''

        const est = ESTADO_LABEL[ot.estado]

        const vals = {
          numero_ot:    esFirst ? `OT-${String(numero_ot).padStart(2,'0')}` : '',
          contratista:  esFirst ? contNombre : '',
          contrato:     esFirst ? (ot.contrato || '').replace(/^contrato\s+/i,'').trim() : '',
          detalle:      esF
                          ? (ot.datos_extra?.detalle_fact || 'Adjunto listado OT por correo electrónico')
                          : (ot.datos_extra?.detalle_inst || 'Adjunto listado OT por correo electrónico'),
          actividad:    esF ? 'Factibilidades' : 'Instalaciones Nuevas',
          fecha_entrega:esFirst ? fmtFecha(ot.datos_extra?.doc_fecha_entrega) : '',
          fi:           fmtFecha(ot.fecha_inicio),
          ff:           fmtFecha(ot.fecha_fin_trabajos),
          fl:           fmtFecha(ot.fecha_limite_expedientes),
          plazo,
          cant_prog:    ot.cantidad_programada ?? '',
          fecha_rep:    fmtFecha(ot.fecha_reporte),
          cant_ent:     ot.cantidad_entregada ?? '',
          estado:       est?.label || '',
          dur_real:     ot.duracion_real ?? '',
          d_fuera:      ot.dias_fuera_plazo ?? 0,
          val_pen:      ot.val_penalidades_manual ? `S/ ${Number(ot.val_penalidades_manual).toFixed(2)}` : '',
          val_total:    ot.val_total_penalidad ? `S/ ${Number(ot.val_total_penalidad).toFixed(2)}` : '',
          obs:          ot.observaciones || '',
        }

        // Campos extra
        for (const c of camposExtra) {
          vals[`extra_${c.clave}`] = ot.datos_extra?.[c.clave] ?? ''
        }

        const dRow = ws.getRow(rowIdx)
        dRow.height = 18
        todasCols.forEach((col, i) => {
          const cell = dRow.getCell(i + 1)
          cell.value = vals[col.key] ?? ''
          cell.font  = { name: 'Arial', size: 9,
            color: { argb: col.key === 'actividad' ? actColor : fgArgb },
            bold: ['numero_ot','actividad'].includes(col.key) }
          cell.fill  = fill(bgArgb)
          cell.alignment = { horizontal: col.align, vertical: 'middle', wrapText: col.key === 'obs' }
          cell.border = border()

          // Estado con color propio
          if (col.key === 'estado' && est) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: est.color } }
            cell.fill = fill(est.fondo)
          }
          // Cantidad programada en negrita
          if (col.key === 'cant_prog' && ot.cantidad_programada) {
            cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: fgArgb } }
          }
        })
        rowIdx++
      }
    }

    // ── Congelar encabezado ──────────────────────────────────────
    ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 1 }]

    // ── Autofilter ───────────────────────────────────────────────
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: nCols } }

    // ── Generar buffer ───────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Instalaciones_Nuevas_${anio || ''}.xlsx"`,
      }
    })
  } catch (e) {
    console.error('genexcel-inst error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
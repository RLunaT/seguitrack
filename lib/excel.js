import * as XLSX from 'xlsx'
import { calcularCamposOT, fmtFecha, fmtPorcentaje, getEficienciaLabel, getEficiencia } from './formulas'

// ═══════════════════════════════════════════════════════════════
// EXPORTAR A EXCEL — respeta columnas visibles del módulo
// ═══════════════════════════════════════════════════════════════
export function exportarExcel(ots, contratistas, modulo, periodo = '2026-I', colsVisibles = {}, camposExtra = [], colsOrdenadas = null) {
  const esOT = modulo?.tipo === 'ot'
  const ESTADO_LABELS = { 1: 'Cumplió a tiempo', 2: 'Cumplió tarde', 3: 'En proceso', 4: 'Por vencer', 5: 'Fuera de plazo' }

  // Función que devuelve el valor de una columna para una OT
  function getValor(col, ot, calc, cont, efic) {
    const k = col.key
    if (k === 'numero_registro')    return ot.numero_registro || ''
    if (k === 'numero_ot')          return esOT ? (ot.numero_ot || '') : ''
    if (k === 'contratista')        return cont?.nombre || ''
    if (k === 'actividad')          return ot.actividad || ''
    if (k === 'motivo_ot')          return ot.motivo_ot || ''
    if (k === 'semana')             return ot.semana || ''
    if (k === 'contrato')           return calc.contrato || ''
    if (k === 'progreso')           return fmtPorcentaje(calc.progreso)
    if (k === 'fecha_inicio')       return ot.fecha_inicio || ''
    if (k === 'fecha_fin_trabajos') return ot.fecha_fin_trabajos || ''
    if (k === 'fecha_limite')       return ot.fecha_limite_expedientes || ''
    if (k === 'dias_plazo')         return calc.dias_plazo ?? ''
    if (k === 'cantidad')           return ot.cantidad_programada ?? ''
    if (k === 'fecha_reporte')      return ot.fecha_reporte || ''
    if (k === 'estado')             return ESTADO_LABELS[calc.estado] || ''
    if (k === 'duracion_real')      return calc.duracion_real ?? ''
    if (k === 'dias_fuera')         return calc.dias_fuera_plazo || ''
    if (k === 'val_pen')            return ot.val_penalidades_manual || ''
    if (k === 'val_total')          return calc.val_total_penalidad || ''
    if (k === 'observaciones')      return ot.observaciones || ''
    if (k === 'eficiencia')         return efic?.label || ''
    if (k.startsWith('extra_')) {
      // Campo extra — busca por id numérico o por clave
      const campo = camposExtra.find(c => `extra_${c.id}` === k || `extra_${c.clave}` === k)
      const clave = campo?.clave || k.replace('extra_', '')
      return ot.datos_extra?.[clave] ?? ''
    }
    return ''
  }

  // Determinar columnas a exportar:
  // Si se pasa colsOrdenadas (desde la tabla), usarlas respetando el orden visual
  // Si no, construir desde COLS_BASE filtrando por tipo y visibilidad
  let todasCols
  if (colsOrdenadas && colsOrdenadas.length > 0) {
    // Agregar N° Registro siempre al inicio
    todasCols = [
      { key: 'numero_registro', label: esOT ? 'N° Registro' : 'N° Registro' },
      ...colsOrdenadas
    ]
  } else {
    const COLS_BASE = [
      { key: 'numero_registro',    label: 'N° Registro',       soloOT: false },
      { key: 'numero_ot',          label: 'N° OT',             soloOT: true  },
      { key: 'contratista',        label: 'Contratista',        soloOT: true  },
      { key: 'actividad',          label: 'Actividad',          soloOT: false },
      { key: 'motivo_ot',          label: 'Motivo OT',          soloOT: true  },
      { key: 'semana',             label: 'Semana',             soloOT: false },
      { key: 'contrato',           label: 'Contrato',           soloOT: true  },
      { key: 'progreso',           label: 'Progreso',           soloOT: false },
      { key: 'fecha_inicio',       label: 'Fecha inicio',       soloOT: false },
      { key: 'fecha_fin_trabajos', label: 'Fecha fin',          soloOT: false },
      { key: 'fecha_limite',       label: 'Fecha límite',       soloOT: false },
      { key: 'dias_plazo',         label: 'Días de plazo',      soloOT: false },
      { key: 'cantidad',           label: 'Cantidad',           soloOT: false },
      { key: 'fecha_reporte',      label: 'Fecha reporte',      soloOT: false },
      { key: 'estado',             label: 'Estado',             soloOT: false },
      { key: 'duracion_real',      label: 'Duración real',      soloOT: false },
      { key: 'dias_fuera',         label: 'Días fuera',         soloOT: false },
      { key: 'val_pen',            label: 'Val. penalidades',   soloOT: true  },
      { key: 'val_total',          label: 'Val. total',         soloOT: true  },
      { key: 'observaciones',      label: 'Observaciones',      soloOT: false },
      { key: 'eficiencia',         label: 'Eficiencia',         soloOT: false },
    ]
    const base = COLS_BASE.filter(c => {
      if (c.soloOT && !esOT) return false
      if (colsVisibles[c.key] === false) return false
      return true
    })
    const extra = camposExtra.map(c => ({ key: `extra_${c.id}`, label: c.nombre }))
    todasCols = [...base, ...extra]
  }

  const headers = todasCols.map(c => c.label)
  const rows = ots.map(ot => {
    const cont = contratistas.find(c => c.id === ot.contratista_id)
    const calc = calcularCamposOT(ot, cont, periodo)
    const efic = getEficienciaLabel(getEficiencia({ ...ot, dias_plazo: calc.dias_plazo }))
    return todasCols.map(col => getValor(col, ot, calc, cont, efic))
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = todasCols.map(c => ({
    wch: c.key === 'contratista' ? 30 : c.key === 'fecha_limite' ? 18 : c.key === 'observaciones' ? 28 : 16
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Registros')
  XLSX.writeFile(wb, `${modulo.nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZAR TEXTO — para comparación robusta
// ═══════════════════════════════════════════════════════════════
function norm(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[°ºn]/g, 'n').replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Mapa de nombres posibles → campo interno
// Diseñado para ser robusto: acepta variaciones de acentos, mayúsculas, espacios, símbolos
const COLUMN_MAP = {
  // N° Registro — ignorar siempre (se asigna automático)
  'n registro': '_ignorar', 'nn registro': '_ignorar',
  'n de registro': '_ignorar', 'num registro': '_ignorar',
  'numero registro': '_ignorar', 'registro': '_ignorar', 'n reg': '_ignorar',
  // N° OT
  'n ot': 'numero_ot', 'nn ot': 'numero_ot', 'nro ot': 'numero_ot',
  'numero ot': 'numero_ot', 'num ot': 'numero_ot', 'n de ot': 'numero_ot',
  'ot': 'numero_ot', 'n  ot': 'numero_ot',
  // Contratista
  'contratista': 'contratista_nombre', 'empresa': 'contratista_nombre',
  // Actividad
  'actividad': 'actividad',
  // Motivo OT
  'motivo ot': 'motivo_ot', 'motivo': 'motivo_ot',
  // Semana
  'semana': 'semana',
  // Contrato / nombre OT (ignorar, se toma del contratista)
  'contrato': '_ignorar', 'nombre ot': '_ignorar',
  // Progreso (calculado)
  'progreso de trabajos': '_ignorar', 'progreso': '_ignorar',
  // Ampliación (ignorar)
  'ampliacion': '_ignorar', 'ampliación': '_ignorar',
  // Fechas
  'fecha inicio de trabajos': 'fecha_inicio', 'fecha inicio': 'fecha_inicio',
  'inicio': 'fecha_inicio', 'f inicio': 'fecha_inicio',
  'fecha final de trabajos': 'fecha_fin_trabajos', 'fecha fin trabajos': 'fecha_fin_trabajos',
  'fecha fin': 'fecha_fin_trabajos', 'fin': 'fecha_fin_trabajos',
  'fecha limite de entrega de expedientes': 'fecha_limite_expedientes',
  'fecha limite entrega expedientes': 'fecha_limite_expedientes',
  'fecha limite': 'fecha_limite_expedientes', 'f limite': 'fecha_limite_expedientes',
  'limite': 'fecha_limite_expedientes',
  'fecha reporte de trabajos': 'fecha_reporte', 'fecha reporte': 'fecha_reporte',
  'f reporte': 'fecha_reporte', 'reporte': 'fecha_reporte',
  // Días calculados (ignorar)
  'dias de ejecucion y reporte': '_ignorar', 'dias plazo': '_ignorar',
  'duracion real': '_ignorar', 'dias fuera de plazo': '_ignorar',
  'estado': '_ignorar', 'eficiencia': '_ignorar',
  // Cantidad
  'cantidad de programados': 'cantidad_programada', 'cantidad programada': 'cantidad_programada',
  'cantidad': 'cantidad_programada', 'cant': 'cantidad_programada',
  // Penalidades
  'valorizacion de penalidades': 'val_penalidades_manual',
  'valorizacion penalidades': 'val_penalidades_manual',
  'val penalidades': 'val_penalidades_manual', 'penalidad': 'val_penalidades_manual',
  'valorizacion total de penalidad': '_ignorar', 'val total penalidad': '_ignorar',
  // Observaciones
  'observaciones': 'observaciones', 'obs': 'observaciones',
  'observacion': 'observaciones',
}

function excelDateToString(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  if (typeof val === 'string') {
    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
    // dd/mm/yyyy o dd-mm-yyyy
    const m = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3]
      return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
    return null
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val)
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    } catch { return null }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// IMPORTAR — robusto ante columnas faltantes, desordenadas o con nombres distintos
// numero_registro opcional; si no existe, se asigna secuencialmente desde baseIndex
// ═══════════════════════════════════════════════════════════════
export function importarExcel(file, contratistas, moduloId, actividadesModulo = [], baseIndex = 0, camposExtra = []) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const wsName = wb.SheetNames[0]
        const ws = wb.Sheets[wsName]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
        if (raw.length < 2) { reject('El archivo está vacío o solo tiene encabezados.'); return }

        // Detectar la fila de encabezado (la que tiene más celdas llenas en las primeras 10)
        let headerRow = 0, maxFilled = 0
        for (let i = 0; i < Math.min(10, raw.length); i++) {
          const filled = (raw[i] || []).filter(v => v !== null && v !== '').length
          if (filled > maxFilled) { maxFilled = filled; headerRow = i }
        }
        const rawHeaders = raw[headerRow] || []
        const headers = rawHeaders.map(h => norm(h))

        // Mapa de campos extra del módulo: nombre normalizado → clave interna
        const extraMap = {}
        camposExtra.forEach(c => {
          extraMap[norm(c.nombre)] = c.clave
        })

        // Mapear cada columna del Excel a su campo interno
        const colMap = {}
        const colsNoReconocidas = []
        headers.forEach((h, idx) => {
          if (!h) return
          const mapped = COLUMN_MAP[h]
          if (mapped !== undefined) {
            if (mapped !== '_ignorar') colMap[idx] = mapped
          } else if (extraMap[h]) {
            // Es un campo extra del módulo
            colMap[idx] = `extra_${extraMap[h]}`
          } else {
            colsNoReconocidas.push(rawHeaders[idx])
          }
        })

        const actividadIdx = headers.findIndex(h => h === 'actividad')
        const tieneNumOT = Object.values(colMap).includes('numero_ot')
        // numero_registro is ALWAYS auto-assigned from row position, never from Excel

        const resultado = [], errores = [], advertencias = []
        let omitidosPorActividad = 0
        let autoNum = baseIndex + 1

        if (colsNoReconocidas.length > 0) {
          advertencias.push(`Columnas no reconocidas (ignoradas): ${colsNoReconocidas.map(c => `"${c}"`).join(', ')}`)
        }

        for (let i = headerRow + 1; i < raw.length; i++) {
          const row = raw[i] || []
          if (row.every(v => v === null || v === '' || v === undefined)) continue

          // Filtrar por actividad del módulo si corresponde
          if (actividadesModulo.length > 0 && actividadIdx >= 0) {
            const actVal = norm(row[actividadIdx] || '')
            const permitida = actividadesModulo.some(a => norm(a) === actVal || actVal.includes(norm(a)))
            if (!permitida) { omitidosPorActividad++; continue }
          }

          const ot = { modulo_id: moduloId, datos_extra: {} }

          // Mapear cada columna reconocida
          Object.entries(colMap).forEach(([idxStr, campo]) => {
            const val = row[parseInt(idxStr)]
            if (val === null || val === '' || val === undefined) return

            if (campo.startsWith('extra_')) {
              // Campo personalizado del módulo → va a datos_extra
              const clave = campo.replace('extra_', '')
              ot.datos_extra[clave] = String(val).trim()
            } else if (['fecha_inicio', 'fecha_fin_trabajos', 'fecha_limite_expedientes', 'fecha_reporte'].includes(campo)) {
              ot[campo] = excelDateToString(val)
            } else if (campo === 'cantidad_programada') {
              ot[campo] = parseInt(val) || null
            } else if (campo === 'val_penalidades_manual') {
              ot[campo] = parseFloat(val) || 0
            } else if (campo === 'contratista_nombre') {
              const nombre = String(val).trim()
              const cont = contratistas.find(c =>
                norm(c.nombre).includes(norm(nombre)) || norm(nombre).includes(norm(c.nombre))
              )
              if (cont) ot.contratista_id = cont.id
              else advertencias.push(`Fila ${i + 1}: Contratista "${nombre}" no encontrado — se deja sin asignar.`)
            } else if (campo === 'numero_ot' || campo === 'numero_registro') {
              ot[campo] = String(val).trim()
            } else {
              ot[campo] = String(val).trim()
            }
          })

          // numero_registro is always positional (assigned after insert by cargar())
          // numero_ot = from Excel or fallback to position
          if (!ot.numero_ot) ot.numero_ot = String(autoNum - 1)

          autoNum++

          // Validación mínima
          if (!ot.fecha_limite_expedientes) {
            errores.push(`Fila ${i + 1}: Sin fecha límite de expedientes — se omite.`)
            continue
          }

          resultado.push(ot)
        }

        if (omitidosPorActividad > 0) {
          advertencias.unshift(`⚠️ ${omitidosPorActividad} fila(s) omitidas: actividad no corresponde a este módulo (${actividadesModulo.join(', ')}).`)
        }

        resolve({ ots: resultado, errores, advertencias })
      } catch (err) {
        reject('Error al leer el archivo: ' + (err.message || String(err)))
      }
    }
    reader.onerror = () => reject('No se pudo leer el archivo.')
    reader.readAsBinaryString(file)
  })
}
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
  'fecha fin': 'fecha_fin_trabajos', 'fin': 'fecha_fin_trabajos', 'f fin': 'fecha_fin_trabajos',
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
  'cantidad': 'cantidad_programada', 'cant': 'cantidad_programada', 'cant prog': 'cantidad_programada',
  'cant programada': 'cantidad_programada',
  'cantidad entregada': 'cantidad_entregada', 'cant entregada': 'cantidad_entregada',
  'cantidad entregado': 'cantidad_entregada', 'cant entregado': 'cantidad_entregada',
  // Penalidades
  'valorizacion de penalidades': 'val_penalidades_manual',
  'valorizacion penalidades': 'val_penalidades_manual',
  'val penalidades': 'val_penalidades_manual', 'penalidad': 'val_penalidades_manual',
  'valorizacion total de penalidad': '_ignorar', 'val total penalidad': '_ignorar',
  // Observaciones
  'observaciones': 'observaciones', 'obs': 'observaciones',
  'observacion': 'observaciones',
}

// ═══════════════════════════════════════════════════════════════
// MATCH TOLERANTE CONTRA LISTA CERRADA
// Usado para cualquier campo cuyo valor válido viene de una lista predefinida
// (actividad, motivo_ot). Ignora mayúsculas, tildes, espacios y guiones distintos.
// Si encuentra coincidencia → devuelve el valor EXACTO de la lista (no el del Excel).
// Si no encuentra ninguna razonable → devuelve null (no se inventa nada).
// ═══════════════════════════════════════════════════════════════
function matchListaCerrada(valorExcel, listaValida) {
  if (!valorExcel || !listaValida || listaValida.length === 0) return null
  const txt = norm(valorExcel)
  if (!txt) return null

  // 1. Coincidencia exacta tras normalizar
  let match = listaValida.find(v => norm(v) === txt)
  if (match) return match

  // 2. Uno contiene al otro (ej. "NTCSE Urb." dentro de "NTCSE Urbano" o viceversa)
  const candidatos = listaValida.filter(v => {
    const nv = norm(v)
    return nv.includes(txt) || txt.includes(nv)
  })
  if (candidatos.length === 1) return candidatos[0]
  // Si hay más de un candidato posible, es ambiguo — no se adivina, se deja sin normalizar
  return null
}

// ═══════════════════════════════════════════════════════════════
// SEMANA — normaliza cualquier escritura a "Semana NN"
// ═══════════════════════════════════════════════════════════════
function normalizarSemana(valorExcel) {
  const txt = String(valorExcel).trim()
  const m = txt.match(/(\d+)/)
  return m ? `Semana ${m[1].padStart(2, '0')}` : txt
}

function excelDateToString(val) {
  if (!val) return null
  if (val instanceof Date) {
    // Fecha inválida (ej. Excel mal interpretó el texto) → no la guardamos
    if (isNaN(val.getTime())) return null
    return val.toISOString().slice(0, 10)
  }
  if (typeof val === 'string') {
    const t = val.trim()
    // ISO: 2026-06-01 o 2026/06/01
    let m = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    if (m) return validarFecha(m[1], m[2], m[3])

    // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (separadores mixtos)
    m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3]
      return validarFecha(y, m[2], m[1])
    }

    // "1 de junio de 2026" / "1 jun 2026" / "01-jun-2026" (mes en texto)
    const MESES = {
      ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4,
      may:5, mayo:5, jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8,
      sep:9, set:9, septiembre:9, setiembre:9, oct:10, octubre:10,
      nov:11, noviembre:11, dic:12, diciembre:12,
    }
    m = norm(t).match(/^(\d{1,2})\s*(?:de\s*)?([a-z]+)\s*(?:de\s*)?(\d{4})/)
    if (m && MESES[m[2]]) return validarFecha(m[3], MESES[m[2]], m[1])

    return null
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val)
      return validarFecha(d.y, d.m, d.d)
    } catch { return null }
  }
  return null
}

// Valida que día/mes/año formen una fecha real (descarta mes 13, día 32, etc.)
// en vez de guardar silenciosamente un dato corrupto.
function validarFecha(y, m, d) {
  y = parseInt(y); m = parseInt(m); d = parseInt(d)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const fecha = new Date(y, m - 1, d)
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════
// IMPORTAR — robusto ante columnas faltantes, desordenadas o con nombres distintos
// numero_registro opcional; si no existe, se asigna secuencialmente desde baseIndex
// ═══════════════════════════════════════════════════════════════
export function importarExcel(file, contratistas, moduloId, actividadesModulo = [], baseIndex = 0, camposExtra = [], motivosModulo = []) {
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
            const actValRaw = row[actividadIdx]
            const permitida = !!matchListaCerrada(actValRaw, actividadesModulo)
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
              const parsed = excelDateToString(val)
              if (parsed) ot[campo] = parsed
              else advertencias.push(`Fila ${i + 1}: el valor "${val}" en una columna de fecha no se pudo interpretar — se deja vacío.`)
            } else if (campo === 'cantidad_programada' || campo === 'cantidad_entregada') {
              // Acepta "10 unid", "1,000", "10.5" → extrae solo el número, avisa si hubo texto descartado
              const txt = String(val).trim()
              const limpio = txt.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
              const num = limpio ? Math.round(parseFloat(limpio[0])) : null
              if (num !== null) {
                ot[campo] = num
                if (txt.replace(/[\d.,\s]/g, '') !== '') {
                  advertencias.push(`Fila ${i + 1}: "${txt}" se interpretó como ${num}.`)
                }
              }
            } else if (campo === 'val_penalidades_manual') {
              const limpio = String(val).trim().replace(/,/g, '').match(/-?\d+(\.\d+)?/)
              ot[campo] = limpio ? parseFloat(limpio[0]) : 0
            } else if (campo === 'contratista_nombre') {
              const nombre = String(val).trim()
              const nNombre = norm(nombre)
              const exactos = contratistas.filter(c => norm(c.nombre) === nNombre)
              const parciales = contratistas.filter(c => norm(c.nombre).includes(nNombre) || nNombre.includes(norm(c.nombre)))
              if (exactos.length === 1) {
                ot.contratista_id = exactos[0].id
              } else if (exactos.length === 0 && parciales.length === 1) {
                ot.contratista_id = parciales[0].id
              } else if (parciales.length > 1) {
                advertencias.push(`Fila ${i + 1}: "${nombre}" coincide con varios contratistas (${parciales.map(c=>c.nombre).join(', ')}) — se deja sin asignar para evitar un error.`)
              } else {
                advertencias.push(`Fila ${i + 1}: Contratista "${nombre}" no encontrado — se deja sin asignar.`)
              }
            } else if (campo === 'numero_ot' || campo === 'numero_registro') {
              ot[campo] = String(val).trim()
            } else if (campo === 'semana') {
              // Normaliza "semana 02", "SEMANA2", "Semana 02" → siempre "Semana 02"
              ot[campo] = normalizarSemana(val)
            } else if (campo === 'actividad') {
              const original = String(val).trim()
              const match = matchListaCerrada(original, actividadesModulo)
              if (match) ot[campo] = match
              else {
                ot[campo] = original
                if (actividadesModulo.length > 0) {
                  advertencias.push(`Fila ${i + 1}: actividad "${original}" no coincide claramente con ninguna de las definidas en el módulo — se guarda tal cual, revísala.`)
                }
              }
            } else if (campo === 'motivo_ot') {
              const original = String(val).trim()
              const match = matchListaCerrada(original, motivosModulo)
              if (match) ot[campo] = match
              else {
                ot[campo] = original
                if (motivosModulo.length > 0) {
                  advertencias.push(`Fila ${i + 1}: motivo "${original}" no coincide claramente con ninguno de los definidos en el módulo — se guarda tal cual, revísalo.`)
                }
              }
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
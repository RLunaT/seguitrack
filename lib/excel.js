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
    // Formato del exportador SeguiTrack: "lu 06/01/2026", "sá 21/08/2026"
    const mDia = t.match(/^[a-záéíóúñ]+\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i)
    if (mDia) return validarFecha(mDia[3], mDia[2], mDia[1])

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

// ═══════════════════════════════════════════════════════════════
// IMPORTAR INSTALACIONES NUEVAS
// Estructura: 2 filas por OT (factibilidades + instalaciones)
// Mapeo flexible de columnas — igual que importarExcel estándar
// El contratista se pasa como parámetro (seleccionado por el usuario)
// El estado lo asigna el sistema automáticamente
// ═══════════════════════════════════════════════════════════════
const COLUMN_MAP_INST = {
  // N° OT
  'n ot': 'numero_ot', 'nn ot': 'numero_ot', 'nro ot': 'numero_ot',
  'numero ot': 'numero_ot', 'num ot': 'numero_ot', 'n de ot': 'numero_ot',
  'ot': 'numero_ot', 'n  ot': 'numero_ot',
  // Detalle OT
  'detalle ot': 'detalle', 'detalle de ot': 'detalle', 'detalle orden de trabajo': 'detalle',
  'detalle': 'detalle', 'descripcion': 'detalle', 'descripcion ot': 'detalle',
  // Actividad
  'actividad': 'actividad',
  // Fechas
  'fecha entrega ot': 'doc_fecha_entrega', 'f entrega ot': 'doc_fecha_entrega',
  'fecha de entrega ot': 'doc_fecha_entrega', 'entrega ot': 'doc_fecha_entrega',
  // Agregar también variantes del original
  'f de inicio trabajo': 'fecha_inicio',
  'fecha de inicio trabajo': 'fecha_inicio',
  'f de inicio': 'fecha_inicio',
  'fecha inicio trabajo': 'fecha_inicio', 'fecha inicio de trabajo': 'fecha_inicio',
  'f inicio': 'fecha_inicio', 'fecha inicio': 'fecha_inicio', 'inicio': 'fecha_inicio',
  'fecha final trabajo': 'fecha_fin_trabajos', 'fecha fin trabajo': 'fecha_fin_trabajos',
  'f final trabajo': 'fecha_fin_trabajos', 'fecha fin trabajos': 'fecha_fin_trabajos',
  'f fin': 'fecha_fin_trabajos', 'fecha fin': 'fecha_fin_trabajos', 'fin': 'fecha_fin_trabajos',
  'fecha limite entrega exp reporte sielse': 'fecha_limite_expedientes',
  'f limite entrega exp reporte sielse': 'fecha_limite_expedientes',
  'fecha limite entrega expedientes': 'fecha_limite_expedientes',
  'fecha limite exp': 'fecha_limite_expedientes',
  'fecha limite': 'fecha_limite_expedientes', 'f limite': 'fecha_limite_expedientes',
  'limite': 'fecha_limite_expedientes', 'f limite exp': 'fecha_limite_expedientes',
  'fecha reporte': 'fecha_reporte', 'f reporte': 'fecha_reporte', 'reporte': 'fecha_reporte',
  // Plazo (calculado — ignorar)
  'plazo': '_ignorar', 'plazo de ejecucion': '_ignorar', 'dias plazo': '_ignorar',
  'plazo de ejecucion ': '_ignorar',
  // Cantidad
  'cantidad': 'cantidad_programada', 'cant': 'cantidad_programada',
  'cant prog': 'cantidad_programada', 'cantidad programada': 'cantidad_programada',
  'cant programada': 'cantidad_programada',
  'cantidad entregada': 'cantidad_entregada', 'cant entregada': 'cantidad_entregada',
  'cant ent': 'cantidad_entregada',
  // Contratista / contrato (ignorar — viene del sistema)
  'contratista': '_ignorar', 'empresa': '_ignorar',
  'n contrato': '_ignorar', 'nn contrato': '_ignorar', 'contrato': '_ignorar',
  // Estado / dur / fuera (calculados — ignorar)
  'estado': '_ignorar', 'dur real': '_ignorar', 'd fuera': '_ignorar',
  'duracion real': '_ignorar', 'dias fuera': '_ignorar',
  'val pen': '_ignorar', 'val total': '_ignorar',
  // Observaciones
  'observaciones': 'observaciones', 'obs': 'observaciones', 'observacion': 'observaciones',
}

export function importarExcelInst(file, { moduloId, contratista, contrato, anio, camposExtra = [] }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
        if (raw.length < 2) { reject('El archivo está vacío o sin datos.'); return }

        // Detectar fila de encabezado (la más llena en las primeras 10)
        let headerRow = 0, maxFilled = 0
        for (let i = 0; i < Math.min(10, raw.length); i++) {
          const filled = (raw[i] || []).filter(v => v !== null && v !== '').length
          if (filled > maxFilled) { maxFilled = filled; headerRow = i }
        }
        const rawHeaders = raw[headerRow] || []
        const headers = rawHeaders.map(h => norm(h))

        // Campos extra del módulo
        const extraMap = {}
        camposExtra.forEach(c => { extraMap[norm(c.nombre)] = c.clave })

        // Mapear columnas
        const colMap = {}
        const colsNoRec = []
        headers.forEach((h, idx) => {
          if (!h) return
          const mapped = COLUMN_MAP_INST[h]
          if (mapped !== undefined) {
            if (mapped !== '_ignorar') colMap[idx] = mapped
          } else if (extraMap[h]) {
            colMap[idx] = `extra_${extraMap[h]}`
          } else {
            colsNoRec.push(rawHeaders[idx])
          }
        })

        const errores = [], advertencias = [], resultado = []
        if (colsNoRec.length > 0)
          advertencias.push(`Columnas no reconocidas (ignoradas): ${colsNoRec.map(c=>`"${c}"`).join(', ')}`)

        // Agrupar filas por OT: cada par fact/inst comparte numero_ot
        let currentNumOT = null
        const otsPorNumero = {} // numero_ot → { fact, inst }

        for (let i = headerRow + 1; i < raw.length; i++) {
          const row = raw[i] || []
          if (row.every(v => v === null || v === '' || v === undefined)) continue

          // Mapear campos de la fila
          const data = { datos_extra: {} }
          Object.entries(colMap).forEach(([idxStr, campo]) => {
            const val = row[parseInt(idxStr)]
            if (val === null || val === '' || val === undefined) return

            if (campo.startsWith('extra_')) {
              data.datos_extra[campo.replace('extra_', '')] = String(val).trim()
            } else if (['fecha_inicio','fecha_fin_trabajos','fecha_limite_expedientes','fecha_reporte'].includes(campo)) {
              const parsed = excelDateToString(val)
              if (parsed) data[campo] = parsed
              else advertencias.push(`Fila ${i+1}: fecha "${val}" no interpretable — se omite.`)
            } else if (campo === 'doc_fecha_entrega') {
              const parsed = excelDateToString(val)
              if (parsed) data.datos_extra.doc_fecha_entrega = parsed
            } else if (['cantidad_programada','cantidad_entregada'].includes(campo)) {
              const txt = String(val).trim()
              const m = txt.replace(/,/g,'').match(/-?\d+(\.\d+)?/)
              if (m) data[campo] = Math.round(parseFloat(m[0]))
            } else if (campo === 'numero_ot') {
              // Acepta "OT-01", "OT01", "1", "01"
              const txt = String(val).trim()
              const m = txt.match(/(\d+)/)
              if (m) data.numero_ot = parseInt(m[1], 10)
            } else if (campo === 'actividad') {
              data.actividad = String(val).trim().toLowerCase()
            } else if (campo === 'detalle') {
              data.detalle = String(val).trim().replace(/\n/g, ' ')
            } else {
              data[campo] = String(val).trim()
            }
          })

          // Determinar si es fact o inst por la columna actividad
          const actRaw = (data.actividad || '').toLowerCase()
          const esFact = actRaw.includes('fact') || actRaw === ''
          const esInst = actRaw.includes('inst') || actRaw.includes('nuevas')

          // Si tiene numero_ot propio, actualizar currentNumOT
          if (data.numero_ot) currentNumOT = data.numero_ot

          if (!currentNumOT) {
            advertencias.push(`Fila ${i+1}: no se pudo determinar el N° OT — se omite.`)
            continue
          }

          if (!otsPorNumero[currentNumOT]) otsPorNumero[currentNumOT] = { fact: null, inst: null }

          const ot = {
            modulo_id:   moduloId,
            contratista_id: contratista?.id || null,
            contrato:    contrato || contratista?.contrato || '',
            numero_ot:   currentNumOT,
            periodo:     String(anio || new Date().getFullYear()),
            datos_extra: {
              ...data.datos_extra,
            },
          }
          if (data.fecha_inicio)              ot.fecha_inicio = data.fecha_inicio
          if (data.fecha_fin_trabajos)        ot.fecha_fin_trabajos = data.fecha_fin_trabajos
          if (data.fecha_limite_expedientes)  ot.fecha_limite_expedientes = data.fecha_limite_expedientes
          if (data.fecha_reporte)             ot.fecha_reporte = data.fecha_reporte
          if (data.cantidad_programada != null) ot.cantidad_programada = data.cantidad_programada
          if (data.cantidad_entregada  != null) ot.cantidad_entregada  = data.cantidad_entregada
          if (data.observaciones)             ot.observaciones = data.observaciones
          if (data.detalle) {
            if (esFact || !esInst) ot.datos_extra.detalle_fact = data.detalle
            else                    ot.datos_extra.detalle_inst = data.detalle
          }

          if (esFact || !esInst) {
            ot.actividad = 'factibilidades'
            otsPorNumero[currentNumOT].fact = ot
          } else {
            ot.actividad = 'instalaciones'
            otsPorNumero[currentNumOT].inst = ot
          }
        }

        // Aplanar grupos en lista de OTs a insertar
        for (const [numOT, grupo] of Object.entries(otsPorNumero)) {
          for (const ot of [grupo.fact, grupo.inst]) {
            if (!ot) continue
            // fecha_limite_expedientes es NOT NULL en BD — validar
            if (!ot.fecha_limite_expedientes) {
              // Intentar derivar de fecha_fin_trabajos + 1 día hábil como fallback
              if (ot.fecha_fin_trabajos) {
                const d = new Date(ot.fecha_fin_trabajos + 'T00:00:00')
                d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : 1)) // si sáb → +2
                ot.fecha_limite_expedientes = d.toISOString().slice(0,10)
                advertencias.push(`OT-${numOT} (${ot.actividad}): F. Límite no encontrada — se calculó automáticamente como ${ot.fecha_limite_expedientes}.`)
              } else {
                errores.push(`OT-${numOT} (${ot.actividad}): Sin fecha límite ni fecha final — se omite.`)
                continue
              }
            }
            resultado.push(ot)
          }
          if (!grupo.fact && !grupo.inst)
            errores.push(`OT-${numOT}: sin datos válidos.`)
        }

        resolve({ ots: resultado, errores, advertencias, total: Object.keys(otsPorNumero).length })
      } catch (err) {
        reject('Error al leer el archivo: ' + (err.message || String(err)))
      }
    }
    reader.onerror = () => reject('No se pudo leer el archivo.')
    reader.readAsBinaryString(file)
  })
}


// pero con FÓRMULAS reales de Excel (no valores fijos) para los campos
// calculados: días de plazo, duración real, días fuera de plazo y
// penalidad total. Si el usuario edita una fecha en el Excel, esas
// columnas y los totales se recalculan solos, igual que en el sistema.
// ═══════════════════════════════════════════════════════════════
const CAMPOS_CALCULADOS_EXCEL = new Set(['dias_plazo', 'duracion_real', 'dias_fuera_plazo', 'val_total_penalidad'])

export function exportarReporteExcel({ ots, columnas, getValor, titulo, subtitulo }) {
  const wb = XLSX.utils.book_new()
  const filaTitulo = titulo || 'Reporte de Órdenes de Trabajo'
  const nCols = columnas.length

  // ── Columnas ocultas de apoyo (siempre presentes, para que las fórmulas
  // funcionen sin importar qué columnas eligió ver el usuario) ──────────
  const idxFI = nCols       // fecha_inicio
  const idxFL = nCols + 1   // fecha_limite
  const idxFR = nCols + 2   // fecha_reporte
  const idxTasa = nCols + 3 // tasa_penalidad del contratista
  const idxManual = nCols + 4 // val_penalidades_manual
  const idxDiasPlazo   = nCols + 5
  const idxDuracion    = nCols + 6
  const idxDiasFuera   = nCols + 7
  const idxValTotal    = nCols + 8
  const colLetra = i => XLSX.utils.encode_col(i)

  const filaEncabezado = 4 // 0-index de la fila de headers
  const primeraFilaDatos = filaEncabezado + 2 // 1-index de Excel

  const aoa = []
  aoa.push([filaTitulo])
  aoa.push([subtitulo || ''])
  aoa.push([])
  aoa.push(['Las columnas de días/duración/penalidad son fórmulas — si editas una fecha, se recalculan solas.'])
  aoa.push([...columnas.map(c => c.label), 'fecha_inicio','fecha_limite','fecha_reporte','tasa_penalidad','val_manual','dias_plazo','duracion_real','dias_fuera_plazo','val_total_penalidad'])

  ots.forEach(ot => {
    const fila = columnas.map(col => {
      if (CAMPOS_CALCULADOS_EXCEL.has(col.key)) return null // se llena luego con fórmula
      if (['fecha_entrega_ot','fecha_inicio','fecha_fin_trabajos','fecha_limite','fecha_reporte'].includes(col.key)) {
        const raw = col.key === 'fecha_entrega_ot' ? ot.datos_extra?.doc_fecha_entrega
          : col.key === 'fecha_limite' ? ot.fecha_limite_expedientes
          : ot[col.key]
        return raw ? new Date(raw + 'T00:00:00') : null
      }
      return getValor(ot, col.key)
    })
    fila.push(
      ot.fecha_inicio ? new Date(ot.fecha_inicio + 'T00:00:00') : null,
      ot.fecha_limite_expedientes ? new Date(ot.fecha_limite_expedientes + 'T00:00:00') : null,
      ot.fecha_reporte ? new Date(ot.fecha_reporte + 'T00:00:00') : null,
      ot._tasa_penalidad || 0,
      ot.val_penalidades_manual || 0,
      null, null, null, null,
    )
    aoa.push(fila)
  })

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // ── Fórmulas por fila ──────────────────────────────────────────────
  ots.forEach((ot, i) => {
    const r = primeraFilaDatos + i
    const cFI = `${colLetra(idxFI)}${r}`
    const cFL = `${colLetra(idxFL)}${r}`
    const cFR = `${colLetra(idxFR)}${r}`
    const cTasa = `${colLetra(idxTasa)}${r}`
    const cManual = `${colLetra(idxManual)}${r}`
    const cPlazo = `${colLetra(idxDiasPlazo)}${r}`
    const cDur = `${colLetra(idxDuracion)}${r}`
    const cFuera = `${colLetra(idxDiasFuera)}${r}`

    ws[cPlazo] = { t:'n', f: `IF(AND(${cFI}<>"",${cFL}<>""),${cFL}-${cFI}+1,"")` }
    ws[cDur]   = { t:'n', f: `IF(${cFR}<>"",${cFR}-${cFI}+1,IF(AND(${cFI}<>"",${cFL}<>"",TODAY()>${cFL}),TODAY()-${cFI}+1,""))` }
    ws[cFuera] = { t:'n', f: `IF(AND(${cPlazo}<>"",${cDur}<>""),MAX(0,${cDur}-${cPlazo}),0)` }
    ws[`${colLetra(idxValTotal)}${r}`] = { t:'n', f: `${cFuera}*${cTasa}+${cManual}` }

    columnas.forEach((col, ci) => {
      if (!CAMPOS_CALCULADOS_EXCEL.has(col.key)) return
      const cVisible = `${colLetra(ci)}${r}`
      const origen = col.key === 'dias_plazo' ? cPlazo : col.key === 'duracion_real' ? cDur
        : col.key === 'dias_fuera_plazo' ? cFuera : `${colLetra(idxValTotal)}${r}`
      ws[cVisible] = { t:'n', f: origen }
    })
  })

  // ── Fila de totales ──────────────────────────────────────────────
  const rTot = primeraFilaDatos + ots.length + 1
  const rIni = primeraFilaDatos, rFin = primeraFilaDatos + ots.length - 1
  XLSX.utils.sheet_add_aoa(ws, [['TOTALES']], { origin: `A${rTot}` })
  if (ots.length > 0) {
    ws[`${colLetra(idxDiasFuera)}${rTot}`] = { t:'n', f: `COUNTIF(${colLetra(idxDiasFuera)}${rIni}:${colLetra(idxDiasFuera)}${rFin},">0")` }
    ws[`${colLetra(idxValTotal)}${rTot}`]  = { t:'n', f: `SUM(${colLetra(idxValTotal)}${rIni}:${colLetra(idxValTotal)}${rFin})` }
  }

  const rango = XLSX.utils.decode_range(ws['!ref'])
  rango.e.r = Math.max(rango.e.r, rTot)
  ws['!ref'] = XLSX.utils.encode_range(rango)

  ws['!cols'] = [
    ...columnas.map(c => ({ wch: c.key==='observaciones'?30 : c.key==='contratista'?26 : 16 })),
    { wch:12, hidden:true }, { wch:12, hidden:true }, { wch:12, hidden:true },
    { wch:10, hidden:true }, { wch:10, hidden:true },
    { wch:10, hidden:true }, { wch:10, hidden:true }, { wch:10, hidden:true }, { wch:12, hidden:true },
  ]
  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:Math.max(0,nCols-1)} },
    { s:{r:1,c:0}, e:{r:1,c:Math.max(0,nCols-1)} },
    { s:{r:3,c:0}, e:{r:3,c:Math.max(0,nCols-1)} },
  ]

  for (let r = primeraFilaDatos; r <= rFin; r++) {
    columnas.forEach((col, ci) => {
      if (['fecha_inicio','fecha_fin_trabajos','fecha_limite','fecha_reporte','fecha_entrega_ot'].includes(col.key)) {
        const cell = ws[`${colLetra(ci)}${r}`]
        if (cell) cell.z = 'dd/mm/yyyy'
      }
    })
    ;[idxFI, idxFL, idxFR].forEach(idx => {
      const cell = ws[`${colLetra(idx)}${r}`]
      if (cell) cell.z = 'dd/mm/yyyy'
    })
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  XLSX.writeFile(wb, `Reporte_OTs_${new Date().toISOString().slice(0,10)}.xlsx`)
}
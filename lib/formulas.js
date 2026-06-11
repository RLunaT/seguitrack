// ═══════════════════════════════════════════════════════════════
// LÓGICA DE FÓRMULAS — SeguiTrack ELECTROPUNO S.A.A.
//
// MÓDULOS DINÁMICOS — cada módulo puede tener distintos campos.
// Las funciones detectan qué fechas están disponibles y adaptan
// el cálculo. Escenarios cubiertos:
//
//   A) fecha_inicio + fecha_limite + fecha_reporte  → flujo completo
//   B) fecha_inicio + fecha_limite  (sin reporte)   → progreso por tiempo
//   C) solo fecha_limite            (sin inicio)     → estado por límite
//   D) solo fecha_reporte           (sin límite)     → marcado como cumplido
//   E) sin ninguna fecha                             → sin estado
// ═══════════════════════════════════════════════════════════════

// ── SEMANAS ───────────────────────────────────────────────────
export function generarSemanas(año = new Date().getFullYear()) {
  const semanas = []
  const inicio = new Date(año, 0, 1)
  const dia = inicio.getDay()
  const diff = dia === 0 ? 1 : dia === 1 ? 0 : 8 - dia
  inicio.setDate(inicio.getDate() + diff)
  let semana = 1
  const cur = new Date(inicio)
  while (cur.getFullYear() <= año && semana <= 53) {
    semanas.push({
      label: `Semana ${String(semana).padStart(2, '0')}`,
      inicio: new Date(cur),
      fin: new Date(cur.getTime() + 6 * 86400000),
    })
    cur.setDate(cur.getDate() + 7)
    semana++
    if (cur.getFullYear() > año) break
  }
  return semanas
}

// ── CONTRATO ─────────────────────────────────────────────────
export function getContrato(contratista) { return contratista?.contrato || '' }

// ── NOMBRE OT ────────────────────────────────────────────────
export function getNombreOT(ot, contratista, periodo = '2026-I') {
  if (!ot.numero_ot || !contratista) return ''
  return `OT N°${ot.numero_ot} ${ot.actividad || ''} ${ot.motivo_ot || ''} ${periodo} ${contratista.contrato || ''} ${ot.semana || ''}`.trim()
}

// ── DÍAS DE PLAZO ─────────────────────────────────────────────
// Solo si existen ambas fechas
export function getDiasPlazo(fecha_inicio, fecha_limite) {
  if (!fecha_inicio || !fecha_limite) return null
  const ini = new Date(fecha_inicio + 'T00:00:00')
  const lim = new Date(fecha_limite + 'T00:00:00')
  return Math.round((lim - ini) / 86400000)
}

// ── PROGRESO ─────────────────────────────────────────────────
// Escenario A & B: progreso por tiempo entre inicio y límite
// Si ya reportó: usa fecha_reporte como punto de referencia (cap 1.0)
// Si no reportó: usa hoy (puede superar 1.0 si está vencido)
// Escenario C (sin inicio): progreso binario 0/1 según si reportó o no
// Escenario D (sin límite, con reporte): 1.0
// Escenario E: 0
export function getProgreso(fecha_inicio, fecha_limite, fecha_reporte) {
  // Con inicio y límite: progreso temporal
  if (fecha_inicio && fecha_limite) {
    const ini = new Date(fecha_inicio + 'T00:00:00')
    const lim = new Date(fecha_limite + 'T00:00:00')
    const ref = fecha_reporte
      ? new Date(fecha_reporte + 'T00:00:00')
      : new Date()
    ref.setHours(0, 0, 0, 0)
    const total = lim - ini
    if (total <= 0) return 1
    return Math.min(1, Math.max(0, (ref - ini) / total))
  }
  // Sin inicio pero con límite: usa % del día actual vs límite desde hoy-30
  if (!fecha_inicio && fecha_limite) {
    if (fecha_reporte) return 1
    return 0
  }
  // Sin límite pero con reporte: completado
  if (fecha_reporte) return 1
  return 0
}

// ── ESTADO ────────────────────────────────────────────────────
// 1 = Cumplió a tiempo  → tiene fecha_reporte Y entregó ≤ fecha_limite
// 2 = Cumplió tarde     → tiene fecha_reporte Y entregó > fecha_limite
// 3 = En proceso        → sin reporte, hoy ≤ límite, > 3 días restantes
// 4 = Por vencer        → sin reporte, hoy ≤ límite, ≤ 3 días restantes
// 5 = Fuera de plazo    → sin reporte, hoy > fecha_limite
//
// Módulos sin fecha_limite:
//   - Con reporte → 1 (cumplido, no podemos medir tardanza)
//   - Sin reporte → null (sin estado evaluable)
export function getEstado(fecha_inicio, fecha_limite, fecha_reporte) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)

  // Sin fecha_limite: solo podemos saber si reportó o no
  if (!fecha_limite) {
    if (fecha_reporte) return 1   // cumplió (sin referencia de tiempo)
    return null                    // sin estado evaluable
  }

  const lim = new Date(fecha_limite + 'T00:00:00')

  // Ya reportó → comparar con límite
  if (fecha_reporte) {
    const rep = new Date(fecha_reporte + 'T00:00:00')
    return rep <= lim ? 1 : 2
  }

  // Sin reporte → evaluar por tiempo restante
  if (hoy > lim) return 5
  const diasRestantes = Math.round((lim - hoy) / 86400000)
  return diasRestantes <= 3 ? 4 : 3
}

// ── INFO DE ESTADO ────────────────────────────────────────────
export function getEstadoInfo(estado) {
  switch (estado) {
    case 1: return { label: '✓ Cumplió a tiempo', color: 'badge-green',  dot: 'bg-green-500'  }
    case 2: return { label: '⚠ Cumplió tarde',    color: 'badge-orange', dot: 'bg-orange-500' }
    case 3: return { label: '● En proceso',        color: 'badge-blue',   dot: 'bg-blue-500'   }
    case 4: return { label: '⚡ Por vencer',        color: 'badge-yellow', dot: 'bg-yellow-500' }
    case 5: return { label: '✗ Fuera de plazo',    color: 'badge-red',    dot: 'bg-red-500'    }
    default: return { label: 'Sin fecha',           color: 'badge-gray',   dot: 'bg-gray-400'   }
  }
}

// ── DURACIÓN REAL ─────────────────────────────────────────────
// Días transcurridos desde inicio hasta reporte (o hasta hoy si vencido)
// Si no hay fecha_inicio: no se puede calcular
export function getDuracionReal(fecha_inicio, fecha_limite, fecha_reporte) {
  if (!fecha_inicio) return null
  const ini = new Date(fecha_inicio + 'T00:00:00')
  if (fecha_reporte) {
    return Math.round((new Date(fecha_reporte + 'T00:00:00') - ini) / 86400000)
  }
  if (!fecha_limite) return null
  const lim = new Date(fecha_limite + 'T00:00:00')
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  if (hoy > lim) return Math.round((hoy - ini) / 86400000)
  return null
}

// ── DÍAS FUERA DE PLAZO ───────────────────────────────────────
// Solo si la duración real supera el plazo asignado
export function getDiasFuera(duracion_real, dias_plazo) {
  if (duracion_real == null || dias_plazo == null) return 0
  return Math.max(0, duracion_real - dias_plazo)
}

// ── VALORIZACIÓN TOTAL ────────────────────────────────────────
export function getValorizacionTotal(dias_fuera, tasa_penalidad, val_manual = 0) {
  const fuera  = dias_fuera || 0
  const manual = val_manual || 0
  const tasa   = tasa_penalidad || 0
  if (fuera === 0 && manual === 0) return 0
  return (fuera * tasa) + manual
}

// ── CÁLCULO COMPLETO DE OT ────────────────────────────────────
export function calcularCamposOT(ot, contratista, periodo = '2026-I') {
  const dias_plazo    = getDiasPlazo(ot.fecha_inicio, ot.fecha_limite_expedientes)
  const progreso      = getProgreso(ot.fecha_inicio, ot.fecha_limite_expedientes, ot.fecha_reporte)
  const estado        = getEstado(ot.fecha_inicio, ot.fecha_limite_expedientes, ot.fecha_reporte)
  const duracion_real = getDuracionReal(ot.fecha_inicio, ot.fecha_limite_expedientes, ot.fecha_reporte)
  const dias_fuera    = getDiasFuera(duracion_real, dias_plazo)
  const tasa          = contratista?.tasa_penalidad || 0
  const val_total     = getValorizacionTotal(dias_fuera, tasa, ot.val_penalidades_manual)

  return {
    contrato:           getContrato(contratista),
    nombre_ot:          getNombreOT(ot, contratista, periodo),
    progreso,
    dias_plazo,
    estado,
    duracion_real,
    dias_fuera_plazo:   dias_fuera,
    val_total_penalidad: val_total,
  }
}

// ── DÍAS RESTANTES (para alertas) ────────────────────────────
export function getDiasRestantes(fecha_limite) {
  if (!fecha_limite) return null
  const lim = new Date(fecha_limite + 'T00:00:00')
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  return Math.round((lim - hoy) / 86400000)
}

// ── FORMATO FECHA ─────────────────────────────────────────────
export function fmtFecha(fecha) {
  if (!fecha) return '—'
  const d = new Date(fecha + 'T00:00:00')
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── FORMATO MONEDA ────────────────────────────────────────────
export function fmtMoneda(valor) {
  if (!valor && valor !== 0) return '—'
  return `S/ ${Number(valor).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
}

export function fmtPorcentaje(valor) {
  return `${Math.round((valor || 0) * 100)}%`
}

// ── CÓDIGO OT ─────────────────────────────────────────────────
// Formato: EPU{semana}{semestre}P{año}  → EPU16IP26
export function generarCodigoOT(semana, periodo = '2026-I') {
  if (!semana) return ''
  const match = String(semana).match(/\d+/)
  const numSemana = match ? match[0].padStart(2, '0') : '00'
  const partes = periodo.split('-')
  const año = partes[0] ? partes[0].slice(-2) : '26'
  const semestre = partes[1] || 'I'
  return `EPU${numSemana}${semestre}P${año}`
}

// ── ÍNDICE DE EFICIENCIA OPERATIVA ───────────────────────────
// Score 0-100 que mide qué tan bien se ejecutó la OT.
// Requiere fecha_inicio + fecha_limite + fecha_reporte para ser preciso.
//
// Si faltan datos parciales, se degrada elegantemente:
//   - Sin fecha_reporte → null (no evaluar OTs en curso)
//   - Sin fecha_inicio  → evalúa solo puntualidad (reporte vs límite)
//   - Sin fecha_limite  → null (sin referencia temporal)
export function getEficienciaOperativa(ot) {
  const { fecha_inicio, fecha_limite_expedientes: fecha_limite, fecha_reporte, dias_plazo } = ot

  // Sin límite no hay referencia → no calcular
  if (!fecha_limite) return null

  const lim = new Date(fecha_limite + 'T00:00:00')
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)

  // OT en curso sin reporte: penalidad provisional solo si ya venció
  if (!fecha_reporte) {
    if (hoy <= lim) return null  // aún dentro de plazo, no penalizar
    const diasExtra = Math.round((hoy - lim) / 86400000)
    return Math.max(0, 40 - diasExtra * 5)
  }

  const rep = new Date(fecha_reporte + 'T00:00:00')
  const diasRelLimite = Math.round((rep - lim) / 86400000) // neg=antes, pos=después

  // 1. Puntualidad (40 pts) — siempre calculable si hay límite + reporte
  let puntualidad
  if (diasRelLimite <= -2)      puntualidad = 100
  else if (diasRelLimite <= 0)  puntualidad = 90
  else if (diasRelLimite === 1) puntualidad = 70
  else if (diasRelLimite === 2) puntualidad = 55
  else if (diasRelLimite === 3) puntualidad = 40
  else puntualidad = Math.max(0, 40 - (diasRelLimite - 3) * 8)

  // 2. Velocidad de ejecución (35 pts) — requiere fecha_inicio
  let velocidad = 0
  if (fecha_inicio) {
    const ini = new Date(fecha_inicio + 'T00:00:00')
    const durReal = Math.max(1, Math.round((rep - ini) / 86400000))
    const plazo   = dias_plazo || Math.max(1, Math.round((lim - ini) / 86400000))
    const ratio   = durReal / plazo
    if (ratio <= 0.8)      velocidad = 100
    else if (ratio <= 1.0) velocidad = 80 + (1 - ratio) / 0.2 * 20
    else if (ratio <= 1.3) velocidad = 50 + (1.3 - ratio) / 0.3 * 30
    else velocidad = Math.max(0, 50 - (ratio - 1.3) * 40)
  }

  // 3. Anticipación del reporte (25 pts)
  const diasAntici = -diasRelLimite
  let anticipacion
  if (diasAntici >= 3)      anticipacion = 100
  else if (diasAntici >= 1) anticipacion = 75 + (diasAntici - 1) * 12.5
  else if (diasAntici === 0) anticipacion = 60
  else anticipacion = Math.max(0, 60 - Math.abs(diasAntici) * 15)

  // Si no hay fecha_inicio: repartir entre puntualidad y anticipación
  const score = fecha_inicio
    ? Math.round(puntualidad * 0.40 + velocidad * 0.35 + anticipacion * 0.25)
    : Math.round(puntualidad * 0.60 + anticipacion * 0.40)

  return Math.min(100, Math.max(0, score))
}

// ── EFICIENCIA COMBINADA (Módulos 1, 2, 3) ────────────────────
// 50% Cantidad + 50% Plazo
// Cantidad: cantidad_entregada / cantidad_programada × 100
// Plazo:    A tiempo=100, tarde: max(0, 100 - días_fuera×10)
export function getEficienciaCombinada(ot) {
  const { fecha_limite_expedientes: fecha_limite, fecha_reporte,
          cantidad_programada, cantidad_entregada } = ot

  if (!fecha_limite) return null

  const tieneCantidad = cantidad_programada > 0 && cantidad_entregada !== null && cantidad_entregada !== undefined
  const tienePlazo    = !!fecha_reporte

  // Si no hay ninguno de los dos factores → null
  if (!tieneCantidad && !tienePlazo) return null

  // Componente cantidad
  let scoreCantidad = null
  if (tieneCantidad) {
    scoreCantidad = Math.min(100, Math.round((Number(cantidad_entregada) / Number(cantidad_programada)) * 100))
  }

  // Componente plazo
  let scorePlazo = null
  if (tienePlazo) {
    const lim = new Date(fecha_limite + 'T00:00:00')
    const rep = new Date(fecha_reporte + 'T00:00:00')
    const diasFuera = Math.round((rep - lim) / 86400000)
    if (diasFuera <= 0) scorePlazo = 100
    else scorePlazo = Math.max(0, 100 - diasFuera * 10)
  }

  // Combinar según lo disponible
  if (scoreCantidad !== null && scorePlazo !== null)
    return Math.round(scoreCantidad * 0.5 + scorePlazo * 0.5)
  if (scoreCantidad !== null) return scoreCantidad
  return scorePlazo
}

// IDs de módulos que usan eficiencia combinada
export const MODULOS_EFICIENCIA_COMBINADA = [1, 2, 3]

export function getEficienciaModulo(ot, moduloId) {
  if (MODULOS_EFICIENCIA_COMBINADA.includes(moduloId)) {
    return getEficienciaCombinada(ot)
  }
  return getEficienciaOperativa(ot)
}

export function getEficienciaLabel(score) {
  if (score === null || score === undefined) return { label: '—', color: '#6b7280', grade: '—' }
  if (score >= 90) return { label: 'Excelente',  color: '#22c55e', grade: 'A' }
  if (score >= 75) return { label: 'Bueno',       color: '#84cc16', grade: 'B' }
  if (score >= 60) return { label: 'Regular',     color: '#eab308', grade: 'C' }
  if (score >= 40) return { label: 'Deficiente',  color: '#f97316', grade: 'D' }
  return               { label: 'Crítico',     color: '#ef4444', grade: 'F' }
}

// ── CÁLCULO COMPLETO CON EFICIENCIA ──────────────────────────
export function calcularCamposConEficiencia(ot, contratista, periodo = '2026-I', moduloId = null) {
  const base = calcularCamposOT(ot, contratista, periodo)
  const eficiencia = moduloId
    ? getEficienciaModulo({ ...ot, dias_plazo: base.dias_plazo }, moduloId)
    : getEficienciaOperativa({ ...ot, dias_plazo: base.dias_plazo })
  return { ...base, eficiencia }
}

// ── LETRA DE COLUMNA ESTILO EXCEL ────────────────────────────
export function colLetra(n) {
  let s = ''
  n = n + 1
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

export const getEficiencia = getEficienciaOperativa
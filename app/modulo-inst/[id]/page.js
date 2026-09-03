'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  calcularCamposOT, calcularCamposConEficiencia, getEstadoInfo, getEficienciaLabel, getEficiencia,
  getDiasRestantes, fmtFecha, fmtMoneda, getNombreOT, generarCodigoOT, colLetra
} from '@/lib/formulas'
import { exportarExcel, importarExcel, importarExcelInst } from '@/lib/excel'
import ModalOT from '@/components/ModalOT'
import ModalInstOT from './ModalInstOT'
import GanttModulo from '@/components/GanttModulo'
import {
  getCfg, buildBody, generarHTMLDoc, descargarWord
} from './docConfig'
import { descargarWordTemplate } from './wordGen'

// Nombre "familia" del módulo, sin el sufijo de período
// (ej: "Contrastes de Medidores 2026-II" -> "Contrastes de Medidores")
function nombreBase(nombre) {
  return nombre.replace(/\s*20\d{2}-(I{1,2})\s*$/i, '').trim()
}
function claveGrupo(nombre) {
  return nombreBase(nombre).toLowerCase()
}
// "2026-I" -> ene-jun, "2026-II" -> jul-dic
function rangoDePeriodo(per) {
  const m = String(per).match(/^(\d{4})-(I{1,2})$/)
  if (!m) return null
  const anio = m[1]
  return m[2] === 'II'
    ? { inicio: `${anio}-07-01`, fin: `${anio}-12-31` }
    : { inicio: `${anio}-01-01`, fin: `${anio}-06-30` }
}
function contratoVigenteEnRango(contrato, rango) {
  if (!rango) return true
  return (!contrato.fecha_inicio || contrato.fecha_inicio <= rango.fin) &&
         (!contrato.fecha_fin    || contrato.fecha_fin    >= rango.inicio)
}

// ── Columnas base — Instalaciones Nuevas ─────────────────────
const CAMPOS_BASE = [
  { key: 'numero_registro',    label: 'N° OT',           always: true  },
  { key: 'contratista',        label: 'Contratista',     always: true  },
  { key: 'contrato',           label: 'N° Contrato',     always: false },
  { key: 'actividad',          label: 'Actividad',       always: true  },
  { key: 'fecha_entrega_ot',   label: 'F. Entrega OT',   always: true  },
  { key: 'fecha_inicio',       label: 'F. Inicio',       always: true  },
  { key: 'fecha_fin_trabajos', label: 'F. Fin',          always: true  },
  { key: 'fecha_limite',       label: 'F. Límite',       always: true  },
  { key: 'dias_plazo',         label: 'Plazo',           always: false },
  { key: 'cantidad',           label: 'Cant. Prog.',     always: true  },
  { key: 'fecha_reporte',      label: 'F. Reporte',      always: false },
  { key: 'cantidad_entregada', label: 'Cant. Ent.',      always: false },
  { key: 'estado',             label: 'Estado',          always: true  },
  { key: 'duracion_real',      label: 'Dur. Real',       always: false },
  { key: 'dias_fuera',         label: 'D. Fuera',        always: false },
  { key: 'val_pen',            label: 'Val. Pen.',       always: false },
  { key: 'val_total',          label: 'Val. Total',      always: false },
  { key: 'observaciones',      label: 'Observaciones',   always: false },
]

export default function ModuloPage() {
  const { id } = useParams()
  const searchParams = useSearchParams()
  // Instalaciones Nuevas usa año, no semestre
  const anioSelec = searchParams.get('anio') || String(new Date().getFullYear())
  const periodoUrl = anioSelec // para compatibilidad con el resto del código
  const [tab, setTab] = useState('tabla')
  const [feriados, setFeriados] = useState([])
  const [capacidades, setCapacidades] = useState({ fact: 20, inst: 25 })
  const [capTab, setCapTab] = useState(null) // 'fact' | 'inst'
  const [capValor, setCapValor] = useState('')
  const [feriadoNuevo, setFeriadoNuevo] = useState({ fecha: '', tipo: 'nacional', descripcion: '' })
  const [savingCap, setSavingCap] = useState(false)
  const [savingFer, setSavingFer] = useState(false)
  const [modulo, setModulo] = useState(null)
  const [ots, setOts] = useState([])
  const [contratistas, setContratistas] = useState([])
  const [camposExtra, setCamposExtra] = useState([])
  const [periodo, setPeriodo] = useState('2026-I')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [modalSeg, setModalSeg]   = useState(false)
  const [otSeg, setOtSeg]         = useState(null)
  const [modalSegInst, setModalSegInst] = useState(false)
  const [segActSelec, setSegActSelec]   = useState(null) // 'fact' | 'inst'
  const [segFecha, setSegFecha]         = useState('')
  const [segCant, setSegCant]           = useState('')
  const [savingSeg, setSavingSeg]       = useState(false)
  const [buscar, setBuscar] = useState('')
  const [filtContratista, setFiltContratista] = useState('')
  const [filtEstado, setFiltEstado] = useState('')
  const [importando, setImportando] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [modalImport, setModalImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importContratista, setImportContratista] = useState('')
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [modoEliminar, setModoEliminar] = useState(false)
  const tablaRef = useRef(null)
  // Modales
  const [modalCampo, setModalCampo] = useState(false)
  const [modalDoc, setModalDoc] = useState(false)
  const [otParaDoc, setOtParaDoc] = useState(null)
  const [docForm, setDocForm] = useState({})
  const [versionFirma, setVersionFirma] = useState('espacios') // 'sin_firmas' | 'espacios' | 'firmado'
  // Edición en bloque
  // Nuevo campo — estilo Excel
  const [nuevoCampo, setNuevoCampo] = useState({ nombre: '', clave: '', tipo: 'texto', opciones: '', obligatorio: false, en_tabla: true, insertarEn: -2 })

  const [colsVisibles, setColsVisibles] = useState(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(`cols_${id}`) || '{}') } catch { return {} }
  })
  const [sortCfg, setSortCfg] = useState({ key: 'numero_ot', dir: 'asc' })
  const [docToast, setDocToast] = useState(null) // { msg, tipo }
  function mostrarToast(msg, tipo = 'info', duracion = 0) {
    setDocToast({ msg, tipo })
    if (duracion > 0) setTimeout(() => setDocToast(null), duracion)
  }
  const [camposTabOrder, setCamposTabOrder] = useState(null)
  const [columnFilters, setColumnFilters] = useState({})

  function setColFilter(key, val) {
    setColumnFilters(prev => ({ ...prev, [key]: val }))
  }
  function toggleSort(key) {
    setSortCfg(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const cargar = useCallback(async () => {
    const [{ data: mod }, { data: otsData }, { data: campos }, { data: cfg }, { data: ferData }, { data: capData }] = await Promise.all([
      supabase.from('modulos').select('*').eq('id', id).single(),
      supabase.from('ots').select('*').eq('modulo_id', parseInt(id)).eq('periodo', anioSelec).order('numero_ot', { ascending: true }),
      supabase.from('modulo_campos').select('*').eq('modulo_id', id).order('orden'),
      supabase.from('config_global').select('*'),
      supabase.from('feriados').select('*').order('fecha'),
      supabase.from('config_global').select('clave,valor').in('clave',['inst_capacidad_fact','inst_capacidad_inst']),
    ])
    const p = anioSelec
    setPeriodo(p)
    setModulo(mod)
    setFeriados(ferData || [])
    // Las claves de capacidad se leen siempre de las mismas keys; ambos módulos
    // (Instalaciones Nuevas y Reubicación) comparten la misma configuración.
    if (capData) {
      const cf = capData.find(c => c.clave === 'inst_capacidad_fact')
      const ci = capData.find(c => c.clave === 'inst_capacidad_inst')
      setCapacidades({ fact: parseInt(cf?.valor)||20, inst: parseInt(ci?.valor)||25 })
    }

    // ── Contratistas vigentes para este módulo/período ──────────────────
    // No depende de que exista una fila en contratista_modulos para ESTE
    // id de módulo en particular: se busca la familia completa (mismo
    // nombre base, sin importar el período) y se filtra por si el
    // contrato de cada contratista está vigente en las fechas del
    // período actual. Sin fechas definidas = contrato vigente siempre.
    let contsOrdenados = []
    if (mod) {
      const { data: todosMods } = await supabase.from('modulos').select('id, nombre, tipo')
      const idsFamiliaReal = (todosMods || [])
        .filter(m => m.tipo === mod.tipo && claveGrupo(m.nombre) === claveGrupo(mod.nombre))
        .map(m => m.id)
      const anchor = idsFamiliaReal.length ? Math.min(...idsFamiliaReal) : mod.id

      const [{ data: rels }, { data: historial }] = await Promise.all([
        supabase.from('contratista_modulos').select('contratista_id, modulo_id, orden').in('modulo_id', idsFamiliaReal.length ? idsFamiliaReal : [mod.id]),
        supabase.from('contratos_historial').select('contratista_id, fecha_inicio, fecha_fin').eq('modulo_id', anchor),
      ])
      const rango = rangoDePeriodo(p)
      const idsVigentes = [...new Set((rels || []).map(r => r.contratista_id))].filter(cid => {
        const contratos = (historial || []).filter(h => h.contratista_id === cid)
        return contratos.length === 0 || contratos.some(c => contratoVigenteEnRango(c, rango))
      })
      if (idsVigentes.length > 0) {
        const { data: conts } = await supabase.from('contratistas').select('*').in('id', idsVigentes).eq('activo', true)
        contsOrdenados = (conts || []).map(c => {
          const rel = (rels || []).find(r => r.contratista_id === c.id && r.modulo_id === mod.id)
              || (rels || []).find(r => r.contratista_id === c.id)
          return { ...c, _orden: rel?.orden ?? 99 }
        }).sort((a, b) => a._orden - b._orden)
      }
    }
    setContratistas(contsOrdenados)

    setCamposExtra(campos || [])
    // numero_registro is always the positional row number within this module
    // Sort by id (insertion order) to get consistent numbering
    const sortedOts = (otsData || []).slice().sort((a,b) => Number(a.numero_ot) - Number(b.numero_ot) || a.id - b.id)
    const calculadas = sortedOts.map((ot, idx) => {
      const cont = contsOrdenados.find(c => c.id === ot.contratista_id)
      return {
        ...ot,
        numero_registro: String(idx + 1),  // always positional, never from DB
        ...calcularCamposConEficiencia(ot, cont, p, parseInt(id)),
        _cont: cont
      }
    })
    setOts(calculadas)
    setLoading(false)
  }, [id, periodoUrl])

  useEffect(() => { cargar() }, [cargar])

  // Auto-scroll al último registro cuando cargan los datos
  useEffect(() => {
    if (ots.length > 0) {
      setTimeout(() => {
        if (tablaRef.current) tablaRef.current.scrollTop = tablaRef.current.scrollHeight
      }, 100)
    }
  }, [ots])

  function isColVisible(key) {
    if (colsVisibles[key] === false) return false
    return true
  }
  function toggleCol(key) {
    const nuevo = { ...colsVisibles, [key]: !isColVisible(key) }
    setColsVisibles(nuevo)
    localStorage.setItem(`cols_${id}`, JSON.stringify(nuevo))
  }

  // Tipo de módulo — disponible desde aquí para todo el componente
  const esOT = modulo?.tipo === 'ot'
  // Actividades dinámicas — antes del return guard para que stats pueda usarlas
  const _actividades = modulo ? (Array.isArray(modulo.actividades) ? modulo.actividades : JSON.parse(modulo.actividades || '[]')) : []
  const act1 = _actividades[0] || 'factibilidades'
  const act2 = _actividades[1] || 'instalaciones'
  function idPrincipal(reg) {
    return esOT ? (reg.numero_ot || reg.numero_registro) : reg.numero_registro
  }
  function labelId() { return esOT ? 'N° OT' : 'N° Registro' }

  // ── Ancho de columnas (redimensionado) ───────────────────────
  const [colWidths, setColWidths] = useState(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(`col_widths_${id}`) || '{}') } catch { return {} }
  })
  const resizingRef = useRef(null)

  function startResize(e, colKey, currentWidth) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = currentWidth || 120
    const th = e.target.closest('th')
    resizingRef.current = { colKey, startX, startW }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev) {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizingRef.current.startX
      const newW  = Math.max(60, resizingRef.current.startW + delta)
      resizingRef.current.currentW = newW
      if (th) { th.style.width = newW + 'px'; th.style.minWidth = newW + 'px' }
    }

    function onUp() {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (resizingRef.current?.currentW) {
        const key  = resizingRef.current.colKey
        const w    = resizingRef.current.currentW
        const scrollTop  = tablaRef.current?.scrollTop  ?? 0
        const scrollLeft = tablaRef.current?.scrollLeft ?? 0
        setColWidths(prev => {
          if (prev[key] === w) return prev
          const next = { ...prev, [key]: w }
          localStorage.setItem(`col_widths_${id}`, JSON.stringify(next))
          return next
        })
        requestAnimationFrame(() => {
          if (tablaRef.current) {
            tablaRef.current.scrollTop  = scrollTop
            tablaRef.current.scrollLeft = scrollLeft
          }
        })
      }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      resizingRef.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function defaultColW(key) {
    if (key === 'numero_registro') return 90
    if (key === 'contratista')     return 150
    if (key === 'observaciones')   return 180
    if (key === 'estado')          return 190
    if (['fecha_inicio','fecha_limite','fecha_reporte','fecha_fin_trabajos','fecha_entrega_ot'].includes(key)) return 100
    if (key === 'progreso')        return 110
    if (['val_pen','val_total'].includes(key)) return 90
    if (['cantidad','cantidad_entregada'].includes(key)) return 100
    if (key === 'numero_ot')       return 70
    if (key === 'semana')          return 90
    if (key === 'actividad')       return 110
    // Doc y Acciones: ancho fijo, no ajustable — evita que el usuario las
    // achique tanto que los botones queden tapados (ver fix más abajo,
    // donde se les quita el handle de resize en el encabezado).
    if (key === 'accion_doc')      return 60
    if (key === 'acciones')        return 115
    return 110
  }

  // Doc y Acciones siempre usan su ancho fijo, ignorando cualquier valor
  // guardado previamente en localStorage (de cuando sí eran ajustables) —
  // así el fix aplica también a usuarios que ya habían achicado esas columnas.
  function getColWidth(key) {
    if (key === 'accion_doc' || key === 'acciones') return defaultColW(key)
    return colWidths[key] || defaultColW(key)
  }

  const stats = {
    total: ots.filter(o => o.actividad === act1).length, // total OTs (por numero_ot único)
    cumplió_tiempo: ots.filter(o => o.estado === 1).length,
    cumplió_tarde: ots.filter(o => o.estado === 2).length,
    en_proceso: ots.filter(o => o.estado === 3).length,
    por_vencer: ots.filter(o => o.estado === 4).length,
    fuera: ots.filter(o => o.estado === 5).length,
    pen_total: ots.reduce((s, o) => s + (o.val_total_penalidad || 0), 0),
    // Cantidades por actividad
    fact_prog: ots.filter(o => o.actividad === act1).reduce((s, o) => s + (o.cantidad_programada || 0), 0),
    fact_ent:  ots.filter(o => o.actividad === act1).reduce((s, o) => s + (o.cantidad_entregada || 0), 0),
    inst_prog: ots.filter(o => o.actividad === act2).reduce((s, o) => s + (o.cantidad_programada || 0), 0),
    inst_ent:  ots.filter(o => o.actividad === act2).reduce((s, o) => s + (o.cantidad_entregada || 0), 0),
  }

  const otsFiltradas = ots.filter(ot => {
    const idBusca = esOT ? `${ot.numero_ot}` : ot.numero_registro
    const txt = `${idBusca} ${ot._cont?.nombre || ''} ${ot.actividad || ''} ${ot.motivo_ot || ''} ${ot.semana || ''} ${ot.observaciones || ''}`.toLowerCase()
    if (buscar && !txt.includes(buscar.toLowerCase())) return false
    if (filtContratista && String(ot.contratista_id) !== filtContratista) return false
    if (filtEstado && String(ot.estado) !== filtEstado) return false
    // Column-level filters
    for (const [key, val] of Object.entries(columnFilters)) {
      if (!val) continue
      const v = String(val).toLowerCase()
      if (key === 'semana' && !(ot.semana || '').toLowerCase().includes(v)) return false
      if (key === 'actividad' && !(ot.actividad || '').toLowerCase().includes(v)) return false
      if (key === 'motivo_ot' && !(ot.motivo_ot || '').toLowerCase().includes(v)) return false
      if (key === 'fecha_inicio' && !(ot.fecha_inicio || '').includes(val)) return false
      if (key === 'fecha_limite' && !(ot.fecha_limite_expedientes || '').includes(val)) return false
      if (key === 'fecha_reporte' && !(ot.fecha_reporte || '').includes(val)) return false
      if (key === 'cantidad' && ot.cantidad_programada !== undefined) {
        if (!String(ot.cantidad_programada || '').includes(v)) return false
      }
    }
    return true
  }).slice().sort((a, b) => {
    const { key, dir } = sortCfg
    const mult = dir === 'asc' ? 1 : -1
    if (key === 'numero_registro') return mult * (parseInt(a.numero_ot) - parseInt(b.numero_ot))
    if (key === 'fecha_inicio') return mult * (a.fecha_inicio || '').localeCompare(b.fecha_inicio || '')
    if (key === 'fecha_limite') return mult * (a.fecha_limite_expedientes || '').localeCompare(b.fecha_limite_expedientes || '')
    if (key === 'fecha_reporte') return mult * (a.fecha_reporte || '').localeCompare(b.fecha_reporte || '')
    if (key === 'cantidad') return mult * ((a.cantidad_programada || 0) - (b.cantidad_programada || 0))
    if (key === 'estado') return mult * ((a.estado || 0) - (b.estado || 0))
    if (key === 'contratista') return mult * (a._cont?.nombre || '').localeCompare(b._cont?.nombre || '')
    if (key === 'semana') return mult * (a.semana || '').localeCompare(b.semana || '')
    return 0
  })

  async function eliminar(id_ot) {
    if (!confirm('¿Eliminar este registro?')) return
    await supabase.from('ots').delete().eq('id', id_ot)
    cargar()
  }

  const [confirmEliminar, setConfirmEliminar] = useState(false)

  async function eliminarSeleccionados() {
    if (seleccionados.size === 0) return
    setConfirmEliminar(true)
  }

  async function confirmarEliminar() {
    const ids = Array.from(seleccionados)
    await supabase.from('ots').delete().in('id', ids)
    setSeleccionados(new Set())
    setModoEliminar(false)
    setConfirmEliminar(false)
    cargar()
  }

  function toggleSeleccion(id_ot) {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id_ot)) next.delete(id_ot)
      else next.add(id_ot)
      return next
    })
  }

  function seleccionarTodas() {
    if (seleccionados.size === otsFiltradas.length) setSeleccionados(new Set())
    else setSeleccionados(new Set(otsFiltradas.map(o => o.id)))
  }

  function handleImportSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setImportFile(file)
    setImportContratista(contratistas[0]?.id ? String(contratistas[0].id) : '')
    setImportResult(null)
    setModalImport(true)
    e.target.value = ''
  }

  async function ejecutarImport() {
    if (!importFile) return
    setImportando(true); setImportResult(null)
    try {
      const cont = contratistas.find(c => String(c.id) === importContratista)
      const { ots: otsImport, errores, advertencias, total } = await importarExcelInst(importFile, {
        moduloId: parseInt(id),
        contratista: cont,
        contrato: cont?.contrato || '',
        anio: anioSelec,
        camposExtra,
      })
      if (otsImport.length > 0) {
        // Verificar cuáles ya existen (por numero_ot + actividad)
        const existentes = new Set(ots.map(o => `${o.numero_ot}_${o.actividad}`))
        const nuevas = otsImport.filter(o => !existentes.has(`${o.numero_ot}_${o.actividad}`))
        const saltadas = otsImport.length - nuevas.length
        if (nuevas.length > 0) {
          // Insertar en batches de 50 para evitar timeout
          const BATCH = 50
          for (let b = 0; b < nuevas.length; b += BATCH) {
            const batch = nuevas.slice(b, b + BATCH)
            const { error } = await supabase.from('ots').insert(batch)
            if (error) throw new Error(error.message)
          }
          await cargar()
        }
        if (saltadas > 0)
          advertencias.push(`${saltadas} fila(s) ya existían en el sistema — se omitieron.`)
        setImportResult({ ok: nuevas.length, total, errores, advertencias })
      } else {
        setImportResult({ ok: 0, total: 0, errores, advertencias })
      }
    } catch (err) {
      setImportResult({ error: err.message || String(err) })
    }
    setImportando(false)
  }

  async function moverCampo(campoId, dir) {
    const sorted = [...camposExtra].sort((a, b) => a.orden - b.orden)
    const pos = sorted.findIndex(x => x.id === campoId)
    if (dir === 'up' && pos === 0) return
    if (dir === 'down' && pos === sorted.length - 1) return
    const swapWith = dir === 'up' ? sorted[pos - 1] : sorted[pos + 1]
    const current = sorted[pos]
    await Promise.all([
      supabase.from('modulo_campos').update({ orden: swapWith.orden }).eq('id', current.id),
      supabase.from('modulo_campos').update({ orden: current.orden }).eq('id', swapWith.id)
    ])
    cargar()
  }

  async function guardarCampo() {
    if (!nuevoCampo.nombre || !nuevoCampo.clave) return
    const clave = nuevoCampo.clave.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const colsTotal = todasColsOrdenadas.filter(c => c.key !== 'acciones')
    let insertIdx
    if (nuevoCampo.insertarEn === -1) insertIdx = 0
    else if (nuevoCampo.insertarEn === -2) insertIdx = colsTotal.length
    else insertIdx = Math.min(nuevoCampo.insertarEn + 1, colsTotal.length)
    await supabase.from('modulo_campos').insert({
      modulo_id: parseInt(id), nombre: nuevoCampo.nombre, clave,
      tipo: nuevoCampo.tipo, opciones: nuevoCampo.opciones || null,
      obligatorio: nuevoCampo.obligatorio, en_tabla: true, orden: insertIdx,
    })
    try {
      const currentOrder = JSON.parse(localStorage.getItem(`cols_order_${id}`) || 'null')
      if (currentOrder) {
        const savedInsertIdx = Math.max(0, insertIdx - 1)
        currentOrder.splice(savedInsertIdx, 0, clave)
        localStorage.setItem(`cols_order_${id}`, JSON.stringify(currentOrder))
      } else {
        const baseOrder = todasColsOrdenadas
          .filter(c => c.key !== 'numero_registro' && c.key !== 'acciones')
          .map(c => c.key.startsWith('extra_') ? (camposExtra.find(x => `extra_${x.id}` === c.key)?.clave || c.key) : c.key)
        baseOrder.splice(Math.max(0, insertIdx - 1), 0, clave)
        localStorage.setItem(`cols_order_${id}`, JSON.stringify(baseOrder))
      }
    } catch(e) { console.warn('localStorage error', e) }
    setModalCampo(false)
    setNuevoCampo({ nombre: '', clave: '', tipo: 'texto', opciones: '', obligatorio: false, en_tabla: true, insertarEn: -2 })
    cargar()
  }
  async function eliminarCampo(campoId) {
    if (!confirm('¿Eliminar este campo?')) return
    await supabase.from('modulo_campos').delete().eq('id', campoId)
    cargar()
  }

  // Genera y descarga el Word directamente sin mostrar modal
  async function generarWordDirecto(ot) {
    // Buscar el par completo de actividades para esta OT
    const numeroOt = ot.numero_ot
    const fact = ots.find(o => o.numero_ot === numeroOt && o.actividad === act1) || ot
    const inst = ots.find(o => o.numero_ot === numeroOt && o.actividad === act2)
    const cont = contratistas.find(c => c.id === ot.contratista_id)

    const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
    const DIAS  = ['do','lu','ma','mi','ju','vi','sá']

    function fmtEntrega(d) {
      if (!d) return ''
      const dt = new Date(d + 'T00:00:00')
      return String(dt.getDate()).padStart(2,'0') + '-' + MESES[dt.getMonth()] + '-' + dt.getFullYear()
    }
    function fmtTabla(d) {
      if (!d) return ''
      const dt = new Date(d + 'T00:00:00')
      return `${DIAS[dt.getDay()]} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
    }
    function diasHab(ini, fin) {
      if (!ini || !fin) return ''
      const d1 = new Date(ini + 'T00:00:00'), d2 = new Date(fin + 'T00:00:00')
      let dias = 0, cur = new Date(d1)
      while (cur <= d2) { if (cur.getDay()!==0&&cur.getDay()!==6) dias++; cur.setDate(cur.getDate()+1) }
      return `${dias} días`
    }

    const contWord = contratistas.find(c => c.id === ot.contratista_id)
    const contNombre = contWord?.nombre || ''
    const firmaSupDefault = contNombre.toLowerCase().includes('san pedro')
      ? 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'
      : contNombre ? `SUPERVISOR "${contNombre}"` : 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'

    const vars = {
      numero_ot:          String(numeroOt || ''),
      contrato:           (ot.contrato || contWord?.contrato || '').replace(/^contrato\s+/i,'').trim(),
      fecha_entrega:      (() => {
        const fe = fact.datos_extra?.doc_fecha_entrega
        if (fe) return fmtEntrega(fe)
        // Fallback: fecha_inicio - 1 día (entrega = inicio - 1 según fórmula Excel)
        if (fact.fecha_inicio) {
          const d = new Date(fact.fecha_inicio + 'T00:00:00'); d.setDate(d.getDate() - 1)
          return fmtEntrega(d.toISOString().slice(0,10))
        }
        return ''
      })(),
      titulo:             fact.datos_extra?.doc_titulo || 'ÓRDENES DE TRABAJO - INSTALACIONES NUEVAS Y FACTIBILIDAD DE SUMINISTROS',
      editado_por:        fact.datos_extra?.editado_por || 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',
      firma_coordinador:  fact.datos_extra?.firma_coordinador || 'COORDINADOR "CONSORCIO SUPERVISOR"',
      firma_area_usuaria: fact.datos_extra?.firma_area_usuaria || 'ÁREA USUARIA - ELECTROPUNO S.A.A.',
      firma_supervisor:   fact.datos_extra?.firma_supervisor || firmaSupDefault,
      fi_fact:      fmtTabla(fact.fecha_inicio),
      ff_fact:      fmtTabla(fact.fecha_fin_trabajos),
      fl_fact:      fmtTabla(fact.fecha_limite_expedientes),
      plazo_fact:   diasHab(fact.fecha_inicio, fact.fecha_fin_trabajos),
      cant_fact:    String(fact.cantidad_programada || ''),
      detalle_fact: fact.datos_extra?.detalle_fact || 'Adjunto listado OT por correo electrónico',
      fi_inst:      fmtTabla(inst?.fecha_inicio),
      ff_inst:      fmtTabla(inst?.fecha_fin_trabajos),
      fl_inst:      fmtTabla(inst?.fecha_limite_expedientes),
      plazo_inst:   diasHab(inst?.fecha_inicio, inst?.fecha_fin_trabajos),
      cant_inst:    String(inst?.cantidad_programada || ''),
      detalle_inst: inst?.datos_extra?.detalle_inst || 'Adjunto listado OT por correo electrónico',
    }

    // Determinar qué template usar (normal o individualización)
    const esIndividualizacion = !!(fact.datos_extra?.detalle_fact && fact.datos_extra.detalle_fact !== 'Adjunto listado OT por correo electrónico')
    const template = esIndividualizacion ? 'template_individualizacion.docx' : 'template_instalaciones.docx'

    try {
      mostrarToast('word-gen', 'info')
      const res = await fetch('/api/genword-inst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, vars })
      })
      if (!res.ok) { mostrarToast('error', 'error'); alert('Error al generar Word: ' + await res.text()); return }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const mUtf8 = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const m = disposition.match(/filename="([^"]+)"/)
      const filename = mUtf8 ? decodeURIComponent(mUtf8[1]) : (m ? m[1] : `OT-${String(vars.numero_ot).padStart(3,'0')} ${modulo?.nombre || 'Instalaciones Nuevas'} ${anioSelec}.docx`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      mostrarToast('word-ok', 'ok')
    } catch(e) { mostrarToast('error', 'error'); alert('Error: ' + e.message) }
  }

  // Genera y descarga el PDF directamente sin mostrar modal — mismo dato
  // de origen que generarWordDirecto, mismo manejo de nombre de archivo.
  async function generarPdfDirecto(ot) {
    const numeroOt = ot.numero_ot
    const fact = ots.find(o => o.numero_ot === numeroOt && o.actividad === act1) || ot
    const inst = ots.find(o => o.numero_ot === numeroOt && o.actividad === act2)
    const cont = contratistas.find(c => c.id === ot.contratista_id)

    const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
    const DIAS  = ['do','lu','ma','mi','ju','vi','sá']
    function fmtEntrega(d) { if (!d) return ''; const dt = new Date(d+'T00:00:00'); return String(dt.getDate()).padStart(2,'0')+'-'+MESES[dt.getMonth()]+'-'+dt.getFullYear() }
    function fmtTabla(d) { if (!d) return ''; const dt = new Date(d+'T00:00:00'); return `${DIAS[dt.getDay()]} ${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` }
    function diasHab(ini, fin) {
      // Plazo = (fin - inicio) + 1 días calendario — igual que Excel F11=(D11-C11)+1
      if (!ini || !fin) return ''
      const d1 = new Date(ini + 'T00:00:00'), d2 = new Date(fin + 'T00:00:00')
      return `${Math.round((d2-d1)/86400000)+1} días`
    }

    const contPdf = contratistas.find(c => c.id === ot.contratista_id)
    const contNombrePdf = contPdf?.nombre || ''
    const firmaSupPdf = contNombrePdf.toLowerCase().includes('san pedro')
      ? 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'
      : contNombrePdf ? `SUPERVISOR "${contNombrePdf}"` : 'SUPERVISOR "Consorcio San Pedro - ITEM 4"'

    const vars = {
      numero_ot:          String(numeroOt||''),
      contrato:           (ot.contrato||contPdf?.contrato||'').replace(/^contrato\s+/i,'').trim(),
      fecha_entrega:      (() => {
        const fe = fact.datos_extra?.doc_fecha_entrega
        if (fe) return fmtEntrega(fe)
        // Fallback: fecha_inicio - 1 día (entrega = inicio - 1 según fórmula Excel)
        if (fact.fecha_inicio) {
          const d = new Date(fact.fecha_inicio + 'T00:00:00'); d.setDate(d.getDate() - 1)
          return fmtEntrega(d.toISOString().slice(0,10))
        }
        return ''
      })(),
      titulo:             fact.datos_extra?.doc_titulo || 'ÓRDENES DE TRABAJO - INSTALACIONES NUEVAS Y FACTIBILIDAD DE SUMINISTROS',
      editado_por:        fact.datos_extra?.editado_por || 'ESPECIALISTA DE MANTENIMIENTO DE CONEXIONES',
      firma_coordinador:  fact.datos_extra?.firma_coordinador || 'COORDINADOR "CONSORCIO SUPERVISOR"',
      firma_area_usuaria: fact.datos_extra?.firma_area_usuaria || 'ÁREA USUARIA - ELECTROPUNO S.A.A.',
      firma_supervisor:   fact.datos_extra?.firma_supervisor || firmaSupPdf,
      fi_fact: fmtTabla(fact.fecha_inicio), ff_fact: fmtTabla(fact.fecha_fin_trabajos), fl_fact: fmtTabla(fact.fecha_limite_expedientes),
      plazo_fact: diasHab(fact.fecha_inicio, fact.fecha_fin_trabajos), cant_fact: String(fact.cantidad_programada||''),
      detalle_fact: fact.datos_extra?.detalle_fact||'Adjunto listado OT por correo electrónico',
      fi_inst: fmtTabla(inst?.fecha_inicio), ff_inst: fmtTabla(inst?.fecha_fin_trabajos), fl_inst: fmtTabla(inst?.fecha_limite_expedientes),
      plazo_inst: diasHab(inst?.fecha_inicio, inst?.fecha_fin_trabajos), cant_inst: String(inst?.cantidad_programada||''),
      detalle_inst: inst?.datos_extra?.detalle_inst||'Adjunto listado OT por correo electrónico',
    }
    const esIndividualizacion = !!(fact.datos_extra?.detalle_fact && fact.datos_extra.detalle_fact !== 'Adjunto listado OT por correo electrónico')
    const template = esIndividualizacion ? 'template_individualizacion.docx' : 'template_instalaciones.docx'
    try {
      mostrarToast('pdf-gen', 'info')
      const res = await fetch('/api/genword-inst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, vars, pdf: true })
      })
      if (!res.ok) { mostrarToast('error', 'error'); alert('Error al generar PDF: ' + await res.text()); return }
      const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `OT-${String(vars.numero_ot).padStart(3,'0')} ${modulo?.nombre || 'Instalaciones Nuevas'} ${anioSelec}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      mostrarToast('pdf-ok', 'ok')
    } catch(e) { mostrarToast('error', 'error'); alert('Error: ' + e.message) }
  }

  function abrirModalDoc(ot) {
    const cont = contratistas.find(c => c.id === ot.contratista_id)
    const hoy = new Date().toISOString().slice(0, 10)
    const codigoOT = generarCodigoOT(ot.semana, periodo)
    setDocForm(buildDocForm(ot, cont, codigoOT, hoy))
    setOtParaDoc(ot)
    setVersionFirma('espacios')
    setModalDoc(true)
  }

  function buildDocForm(ot, cont, codigoOT, hoy) {
    const de = ot.datos_extra || {}
    return {
      numero_ot:          ot.numero_ot,
      codigo_ot:          de.doc_codigo_ot    || codigoOT,
      contrato:           cont?.contrato || '',
      semana:             ot.semana || '',
      periodo:            periodo || '',
      fecha_inicio:       ot.fecha_inicio || '',
      fecha_fin:          ot.fecha_fin_trabajos || '',
      fecha_limite:       ot.fecha_limite_expedientes || '',
      // Plazo de ejecución para el documento: siempre inicia en 1 por defecto
      // (no el cálculo real ot.dias_plazo, que puede ser 12+ días) — editable
      // manualmente con doc_dias_plazo.
      dias_plazo:         de.doc_dias_plazo || '1',
      cantidad:           ot.cantidad_programada || '',
      fecha_entrega:      de.doc_fecha_entrega      || hoy,
      coordinador:        de.doc_coordinador        || 'CONSORCIO SUPERVISOR',
      area_usuaria:       de.doc_area_usuaria       || 'ELECTROPUNO S.A.A',
      contratista_nombre: de.doc_contratista_firma  || cont?.nombre || '',
      firma4:             de.doc_firma4             || '',
      actividad_doc:      de.doc_actividad          || modulo?.plantilla_actividad || ot.actividad || '',
      actividad_label:    de.doc_actividad          || modulo?.plantilla_actividad || ot.actividad || '',
      editado_por:        de.doc_editado_por        || modulo?.plantilla_editado_por || '',
      cumplimiento:       de.doc_cumplimiento       || modulo?.plantilla_cumplimiento || '',
      titulo:             de.doc_titulo             || modulo?.plantilla_titulo || '',
      observaciones:      ot.observaciones || 'Ninguna',
      motivo_extra:       ot.motivo_ot || '',
      version_firma:      de.doc_version || 'espacios',
    }
  }


  if (loading) return (
    <div className="flex flex-col h-full animate-pulse">
      <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-3" style={{background:'#0f172a'}}>
        <div className="w-9 h-9 rounded-lg bg-gray-800"/>
        <div><div className="h-4 w-40 bg-gray-800 rounded mb-1"/><div className="h-3 w-56 bg-gray-900 rounded"/></div>
      </div>
      <div className="grid gap-3 px-6 py-3" style={{gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))'}}>
        {[1,2,3,4,5,6].map(i=><div key={i} className="h-16 bg-gray-900 rounded-lg"/>)}
      </div>
      <div className="px-6 pb-2"><div className="h-8 bg-gray-900 rounded-lg w-full"/></div>
      <div className="px-6 flex-1"><div className="rounded-xl border border-gray-800 overflow-hidden">
        {[1,2,3,4,5].map(i=><div key={i} className="h-10 border-b border-gray-900 bg-gray-950"/>)}
      </div></div>
    </div>
  )
  if (!modulo) return <div className="p-6 text-gray-400">Módulo no encontrado.</div>

  const actividades = _actividades
  const motivos = Array.isArray(modulo.motivos) ? modulo.motivos : JSON.parse(modulo.motivos || '[]')
  const tienePlantilla = !!modulo.plantilla_titulo

  // Labels para mostrar en UI — capitaliza primera letra de cada palabra
  function actLabel(act) {
    if (act === 'factibilidades') return 'Factibilidades'
    if (act === 'instalaciones') return 'Inst. Nuevas'
    if (act === 'ejecucion') return 'Ejecución'
    return act.charAt(0).toUpperCase() + act.slice(1)
  }
  function actLabelLong(act) {
    if (act === 'factibilidades') return 'Factibilidades'
    if (act === 'instalaciones') return 'Instalaciones Nuevas'
    if (act === 'ejecucion') return 'Ejecución'
    return act.charAt(0).toUpperCase() + act.slice(1)
  }

  // Columnas visibles para la vista previa estilo Excel
  const colsActivasBase = CAMPOS_BASE.filter(c => {
    if (c.key === 'val_pen' || c.key === 'val_total') return modulo.tiene_penalidad
    if (c.key === 'contratista') return esOT && contratistas.length > 0
    if (c.key === 'numero_ot')   return esOT
    if (c.key === 'motivo_ot')   return esOT
    if (c.key === 'contrato')    return esOT
    if (c.key === 'accion_doc')  return esOT && tienePlantilla
    if (c.key === 'cantidad_entregada') return [1,2,3].includes(parseInt(id))
    return true
  }).filter(c => isColVisible(c.key))

  // Orden unificado guardado al crear el módulo
  const savedOrder = (() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem(`cols_order_${id}`) || 'null') } catch { return null }
  })()

  const todasColsOrdenadas = (() => {
    const result = [{ key: 'numero_registro', label: 'N° Reg.' }]
    const baseKeys = new Set(CAMPOS_BASE.map(c => c.key))
    const baseColMap = Object.fromEntries(CAMPOS_BASE.map(c => [c.key, { key: c.key, label: c.label }]))
    const extraByClave = Object.fromEntries(
      camposExtra.filter(c => c.en_tabla).map(c => [c.clave, { key: `extra_${c.id}`, label: c.nombre, id: c.id }])
    )
    const extraUsados = new Set()
    if (savedOrder && savedOrder.length > 0) {
      // Columnas nuevas que no estaban en el orden guardado → inyectarlas en posición lógica
      const nuevasBase = colsActivasBase.filter(c =>
        c.key !== 'numero_registro' && !savedOrder.includes(c.key)
      )
      savedOrder.forEach(k => {
        if (k === 'numero_registro' || k === 'acciones') return
        if (baseKeys.has(k)) {
          if (isColVisible(k) && baseColMap[k]) result.push(baseColMap[k])
          // Si esta es progreso, inyectar fecha_entrega_ot justo después si aplica
          if (k === 'progreso' && nuevasBase.find(c => c.key === 'fecha_entrega_ot')) {
            result.push({ key: 'fecha_entrega_ot', label: 'F. Entrega OT' })
          }
          // Si esta es fecha_reporte, inyectar cantidad_entregada justo después si aplica
          if (k === 'fecha_reporte' && nuevasBase.find(c => c.key === 'cantidad_entregada')) {
            result.push({ key: 'cantidad_entregada', label: 'Cant. Entregada' })
          }
        } else {
          const extra = extraByClave[k]
          if (extra) { result.push(extra); extraUsados.add(extra.id) }
        }
      })
      // Otras columnas nuevas no inyectadas aún
      nuevasBase.filter(c => c.key !== 'cantidad_entregada' && !result.find(r => r.key === c.key))
        .forEach(c => result.push(c))
      camposExtra.filter(c => c.en_tabla && !extraUsados.has(c.id))
        .sort((a,b) => a.orden - b.orden)
        .forEach(c => result.push({ key: `extra_${c.id}`, label: c.nombre }))
    } else {
      colsActivasBase.filter(c => c.key !== 'numero_registro').forEach(c => result.push(c))
      camposExtra.filter(c => c.en_tabla).sort((a,b) => a.orden - b.orden)
        .forEach(c => result.push({ key: `extra_${c.id}`, label: c.nombre }))
    }
    result.push({ key: 'acciones', label: 'Acciones' })
    return result
  })()

  // Gestión de orden en pestaña Campos
  const camposOrden = camposTabOrder || todasColsOrdenadas.filter(c => c.key !== 'acciones')

  function guardarOrdenCampos(arr) {
    const newOrder = arr
      .filter(c => c.key !== 'numero_registro')
      .map(c => {
        if (c.key.startsWith('extra_')) {
          const campo = camposExtra.find(x => `extra_${x.id}` === c.key)
          return campo?.clave || c.key
        }
        return c.key
      })
    localStorage.setItem(`cols_order_${id}`, JSON.stringify(newOrder))
    arr.forEach(async (col, i) => {
      if (col.key.startsWith('extra_')) {
        const campo = camposExtra.find(c => `extra_${c.id}` === col.key)
        if (campo) await supabase.from('modulo_campos').update({ orden: i }).eq('id', campo.id)
      }
    })
  }

  function moverEnCampos(idx, dir) {
    const arr = [...camposOrden]
    const target = idx + dir
    if (target < 0 || target >= arr.length) return
    ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
    setCamposTabOrder(arr)
    guardarOrdenCampos(arr)
  }

  function activarColEnCampos(key) {
    const col = CAMPOS_BASE.find(c => c.key === key)
    if (!col) return
    const nuevo = { ...colsVisibles, [key]: true }
    setColsVisibles(nuevo)
    localStorage.setItem(`cols_${id}`, JSON.stringify(nuevo))
    const arr = [...camposOrden, { key, label: col.label }]
    setCamposTabOrder(arr)
    guardarOrdenCampos(arr)
  }

  function desactivarColEnCampos(idx) {
    const col = camposOrden[idx]
    if (!col || col.key === 'numero_registro') return
    if (['estado', 'fecha_limite'].includes(col.key)) return
    if (!col.key.startsWith('extra_')) {
      const nuevo = { ...colsVisibles, [col.key]: false }
      setColsVisibles(nuevo)
      localStorage.setItem(`cols_${id}`, JSON.stringify(nuevo))
    }
    const arr = camposOrden.filter((_, i) => i !== idx)
    setCamposTabOrder(arr)
    guardarOrdenCampos(arr)
  }


  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2" style={{ background: '#0f172a' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xl" style={{ background: `${modulo.color}20`, border: `1px solid ${modulo.color}40` }}>
            {modulo.icono}
          </div>
          <div>
            <h1 className="text-base font-bold text-white">{modulo.nombre}</h1>
            <p className="text-xs text-gray-500">{modulo.descripcion}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end items-center">
          {/* Selector de año — control de tiempo para Instalaciones Nuevas */}
          <div className="flex items-center gap-0 border border-gray-700 rounded-lg overflow-hidden mr-1">
            {[String(new Date().getFullYear()-1), String(new Date().getFullYear()), String(new Date().getFullYear()+1)].map(a => (
              <button key={a}
                onClick={() => { const p = new URLSearchParams(window.location.search); p.set('anio', a); window.history.pushState(null, '', `?${p.toString()}`); window.location.reload() }}
                className="px-3 py-1.5 text-xs font-semibold transition-all"
                style={anioSelec === a ? { background: '#06b6d4', color: '#000' } : { background: 'transparent', color: '#5c7a9e' }}>
                {a}
              </button>
            ))}
          </div>
          <label className="btn-ghost cursor-pointer text-xs">
            {importando ? '⏳...' : '⬆️ Importar Excel'}
            <input type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={handleImportSelect} disabled={importando} />
          </label>
          <button className="btn-ghost text-xs" onClick={async () => {
            try {
              const res = await fetch('/api/genexcel-inst', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ots: otsFiltradas,
                  contratistas,
                  modulo,
                  anio: anioSelec,
                  camposExtra,
                  act1,
                  act2,
                })
              })
              if (!res.ok) { alert('Error al exportar: ' + await res.text()); return }
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `Instalaciones_Nuevas_${anioSelec}.xlsx`
              document.body.appendChild(a); a.click(); document.body.removeChild(a)
              setTimeout(() => URL.revokeObjectURL(url), 10000)
            } catch(e) { alert('Error: ' + e.message) }
          }}>⬇️ Exportar Excel</button>
          <button className="btn-primary text-xs" onClick={() => { setEditando(null); setModalOpen(true) }}>+ Nuevo Registro</button>
        </div>
      </div>

      {/* Resultado importación */}
      {importResult && (
        <div className={`mx-6 mt-3 p-3 rounded-lg border text-xs flex items-start justify-between gap-4 ${importResult.error ? 'border-red-800 bg-red-950 text-red-300' : 'border-green-800 bg-green-950 text-green-300'}`}>
          <div>
            {importResult.error ? <span>❌ {importResult.error}</span> : (
              <div>
                <div>✅ {importResult.ok} registro(s) importados.</div>
                {importResult.advertencias?.slice(0, 5).map((a, i) => <div key={i} className="text-yellow-400 mt-1">{a}</div>)}
                {importResult.errores?.slice(0, 3).map((e, i) => <div key={i} className="text-red-400 mt-1">❌ {e}</div>)}
              </div>
            )}
          </div>
          <button className="text-gray-400 hover:text-white flex-shrink-0" onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-2 px-6 py-3" style={{ gridTemplateColumns: '1fr 1fr 0.6fr 0.6fr' }}>

        {/* Actividad 1 (Factibilidades) */}
        <div className="card py-2.5 px-3" style={{ border: '1.5px solid #1D9E75' }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{actLabelLong(act1)}</div>
          <div className="flex items-baseline gap-1.5 mb-1.5">
            <span className="text-xl font-bold font-mono" style={{ color: '#1D9E75' }}>{stats.fact_ent}</span>
            <span className="text-xs text-gray-500">entregadas</span>
          </div>
          <div style={{ height: 4, background: '#1e293b', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: '#1D9E75', width: `${stats.fact_prog ? Math.round(stats.fact_ent / stats.fact_prog * 100) : 0}%` }} />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Prog. <span className="text-gray-300">{stats.fact_prog}</span></span>
            <span className="text-gray-500">Pend. <span className="text-gray-300">{Math.max(0, stats.fact_prog - stats.fact_ent)}</span></span>
            <span style={{ color: '#1D9E75', fontWeight: 500 }}>{stats.fact_prog ? Math.round(stats.fact_ent / stats.fact_prog * 100) : 0}%</span>
          </div>
        </div>

        {/* Actividad 2 (Instalaciones / Ejecución) */}
        <div className="card py-2.5 px-3" style={{ border: '1.5px solid #7F77DD' }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{actLabelLong(act2)}</div>
          <div className="flex items-baseline gap-1.5 mb-1.5">
            <span className="text-xl font-bold font-mono" style={{ color: '#7F77DD' }}>{stats.inst_ent}</span>
            <span className="text-xs text-gray-500">entregadas</span>
          </div>
          <div style={{ height: 4, background: '#1e293b', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: '#7F77DD', width: `${stats.inst_prog ? Math.round(stats.inst_ent / stats.inst_prog * 100) : 0}%` }} />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Prog. <span className="text-gray-300">{stats.inst_prog}</span></span>
            <span className="text-gray-500">Pend. <span className="text-gray-300">{Math.max(0, stats.inst_prog - stats.inst_ent)}</span></span>
            <span style={{ color: '#7F77DD', fontWeight: 500 }}>{stats.inst_prog ? Math.round(stats.inst_ent / stats.inst_prog * 100) : 0}%</span>
          </div>
        </div>

        {/* Total OTs */}
        <div className="card py-2.5 px-3" style={{ borderTop: `2px solid ${modulo?.color || '#378ADD'}` }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Total OTs</div>
          <div className="text-xl font-bold font-mono" style={{ color: modulo?.color || '#378ADD' }}>{stats.total}</div>
          <div className="text-xs text-gray-600 mt-1">año {anioSelec}</div>
        </div>

        {/* Estado */}
        <div className="card py-2.5 px-3" style={{ borderTop: '2px solid #374151' }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Estado</div>
          <div className="flex flex-col gap-1">
            {[
              { label: 'A tiempo',    val: stats.cumplió_tiempo, bg: '#052e16', color: '#22c55e' },
              { label: 'En proceso',  val: stats.en_proceso,     bg: '#1e3a5f', color: '#3b82f6' },
              { label: 'Por vencer',  val: stats.por_vencer,     bg: '#422006', color: '#f97316' },
              { label: 'Fuera plazo', val: stats.fuera,          bg: '#450a0a', color: '#ef4444' },
            ].map(s => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{s.label}</span>
                <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>{s.val}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b border-gray-800">
        {[
          { key: 'tabla', label: '📋 Listado' },
          { key: 'gantt', label: '📅 Gantt' },
          { key: 'campos', label: '⚙️ Campos' },
          { key: 'feriados', label: '🗓 Feriados y capacidad' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-all ${tab === t.key ? 'border-blue-500 text-blue-400 bg-blue-950' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">

        {/* ── TABLA ── */}
        {tab === 'tabla' && (
          <>
            {/* ── Barra de filtros compacta ── */}
            <div className="mb-3">
              <div className="flex gap-1.5 items-center p-2 rounded-lg border border-gray-800" style={{background:'#0d1526'}}>
                <input className="input-base text-xs" style={{width:150}} placeholder="🔍 Buscar..." value={buscar} onChange={e=>setBuscar(e.target.value)} />
                <select className="input-base text-xs" style={{width:110}} value={filtEstado} onChange={e=>setFiltEstado(e.target.value)}>
                  <option value="" disabled hidden>Estado</option>
                  <option value="">Todos los estados</option>
                  <option value="1">✓ Cumplió a tiempo</option>
                  <option value="2">⚠ Cumplió tarde</option>
                  <option value="3">● En proceso</option>
                  <option value="4">⚡ Por vencer</option>
                  <option value="5">✗ Fuera de plazo</option>
                </select>
                {isColVisible('contratista') && contratistas.length > 0 && (
                  <select className="input-base text-xs" style={{width:130}} value={filtContratista} onChange={e=>setFiltContratista(e.target.value)}>
                    <option value="" disabled hidden>Contratista</option>
                    <option value="">Todos los contratistas</option>
                    {contratistas.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                )}
                {isColVisible('actividad') && actividades.length > 0 && (
                  <select className="input-base text-xs" style={{width:110}} value={columnFilters.actividad||''} onChange={e=>setColFilter('actividad',e.target.value)}>
                    <option value="" disabled hidden>Actividad</option>
                    <option value="">Todas las actividades</option>
                    {actividades.map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                {isColVisible('motivo_ot') && motivos.length > 0 && (
                  <select className="input-base text-xs" style={{width:100}} value={columnFilters.motivo_ot||''} onChange={e=>setColFilter('motivo_ot',e.target.value)}>
                    <option value="" disabled hidden>Motivo</option>
                    <option value="">Todos los motivos</option>
                    {motivos.map(m=><option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                {isColVisible('semana') && (
                  <select className="input-base text-xs" style={{width:100}} value={columnFilters.semana||''} onChange={e=>setColFilter('semana',e.target.value)}>
                    <option value="" disabled hidden>Semana</option>
                    <option value="">Todas las semanas</option>
                    {[...new Set(ots.map(o=>o.semana).filter(Boolean))].sort().map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {(isColVisible('fecha_inicio')||isColVisible('fecha_limite')||isColVisible('fecha_reporte')) && (
                  <button className={`text-xs px-2 py-1 rounded border transition-all ${(columnFilters.fecha_inicio||columnFilters.fecha_limite||columnFilters.fecha_reporte)?'border-blue-600 bg-blue-950 text-blue-300':'border-gray-700 text-gray-500 hover:text-gray-300'}`}
                    onClick={()=>setColFilter('_showFechas', columnFilters._showFechas?'':'1')}>
                    📅 Fechas{(columnFilters.fecha_inicio||columnFilters.fecha_limite||columnFilters.fecha_reporte)?' ●':''}
                  </button>
                )}
                {(buscar||filtEstado||filtContratista||Object.values(columnFilters).some(v=>v&&v!=='1')) && (
                  <button className="text-xs px-2 py-1 rounded border border-red-900 text-red-400 hover:bg-red-950"
                    onClick={()=>{setColumnFilters({});setFiltContratista('');setFiltEstado('');setBuscar('')}}>✕</button>
                )}
                <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{otsFiltradas.length}/{ots.length} registros</span>
                  {!modoEliminar ? (
                    <button className="btn-ghost text-xs px-2 py-1" onClick={()=>setModoEliminar(true)}>🗑️ Eliminar</button>
                  ) : (
                    <div className="flex gap-1 items-center">
                      <button className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-400" onClick={seleccionarTodas}>{seleccionados.size===otsFiltradas.length?'☐ Ninguna':'✅ Todas'}</button>
                      <button className="btn-danger text-xs px-2 py-1" disabled={seleccionados.size===0} onClick={eliminarSeleccionados}>🗑️{seleccionados.size>0?` (${Math.ceil(seleccionados.size/2)})`:''}</button>
                      <button className="btn-ghost text-xs px-2 py-1" onClick={()=>{setModoEliminar(false);setSeleccionados(new Set())}}>✕</button>
                    </div>
                  )}
                </div>
              </div>
              {columnFilters._showFechas && (
                <div className="flex gap-3 items-center mt-1.5 px-2 py-1.5 rounded-lg border border-blue-900" style={{background:'#0a1628'}}>
                  <span className="text-xs text-gray-500 flex-shrink-0">Filtrar por mes:</span>
                  {isColVisible('fecha_inicio') && <div className="flex items-center gap-1"><span className="text-xs text-gray-400">Inicio</span><input className="input-base text-xs" type="month" style={{width:150}} value={columnFilters.fecha_inicio||''} onChange={e=>setColFilter('fecha_inicio',e.target.value)} /></div>}
                  {isColVisible('fecha_limite') && <div className="flex items-center gap-1"><span className="text-xs text-gray-400">Límite</span><input className="input-base text-xs" type="month" style={{width:150}} value={columnFilters.fecha_limite||''} onChange={e=>setColFilter('fecha_limite',e.target.value)} /></div>}
                  {isColVisible('fecha_reporte') && <div className="flex items-center gap-1"><span className="text-xs text-gray-400">Reporte</span><input className="input-base text-xs" type="month" style={{width:150}} value={columnFilters.fecha_reporte||''} onChange={e=>setColFilter('fecha_reporte',e.target.value)} /></div>}
                </div>
              )}
            </div>
            {/* Tabla con header sticky */}
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div ref={tablaRef} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                <table className="tabla-base" style={{ width: todasColsOrdenadas.reduce((s,c) => s + getColWidth(c.key), 0) }}>
                  <colgroup>
                    {todasColsOrdenadas.map(col => (
                      <col key={col.key} style={{ width: getColWidth(col.key) }} />
                    ))}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0f172a' }}>
                    <tr>
                      {modoEliminar && <th className="w-8"><input type="checkbox" className="accent-blue-500" checked={seleccionados.size===otsFiltradas.length && otsFiltradas.length>0} onChange={seleccionarTodas} /></th>}
                      {todasColsOrdenadas.map(col => {
                        const w = colWidths[col.key] || defaultColW(col.key)
                        if (col.key === 'numero_registro') return <th key="nr" style={{minWidth:90,width:90,padding:'4px 8px',textAlign:'center',fontSize:'0.7rem',color:'#6b7280',background:'#0f172a',position:'sticky',left:0,zIndex:2,borderRight:'2px solid #1e293b',position:'relative'}}>N° OT<span className="col-resize-handle" onMouseDown={e=>{e.stopPropagation();startResize(e,'numero_registro',w)}}/></th>
                        if (col.key === 'numero_ot') return <SortTh key="not" k="numero_ot" label={labelId()} sc={sortCfg} ts={toggleSort} onResize={e => startResize(e, col.key, w)} />
                        // Doc y Acciones: sin handle de resize — ancho fijo siempre,
                        // para que los botones nunca queden tapados.
                        if (col.key === 'acciones') return <th key="acc" style={{position:'relative',borderLeft:'2px solid #1e3a5f',background:'#0d1e36',color:'#60a5fa'}}>Acciones</th>
                        if (col.key === 'inst_seguim') return null
                        if (col.key === 'inst_doc') return null
                        if (col.key === 'inst_editar') return null
                        if (col.key === 'accion_doc') return <th key="accdoc" style={{position:'relative'}}>Doc</th>
                        if (col.key.startsWith('extra_')) return <th key={col.key} style={{position:'relative'}}>{col.label}<span className="col-resize-handle" onMouseDown={e=>{e.stopPropagation();startResize(e,col.key,w)}}/></th>
                        if (['contratista','semana','fecha_inicio','fecha_limite','fecha_reporte','cantidad','estado'].includes(col.key))
                          return <SortTh key={col.key} k={col.key} label={col.label} sc={sortCfg} ts={toggleSort} onResize={e => startResize(e, col.key, w)} />
                        return <th key={col.key} style={{position:'relative'}}>{col.label}<span className="col-resize-handle" onMouseDown={e=>{e.stopPropagation();startResize(e,col.key,w)}}/></th>
                      })}
                    </tr>
                  </thead><tbody>
                    {otsFiltradas.length === 0 ? (
                      <tr><td colSpan={30} className="text-center py-12 text-gray-600">Sin registros. Haz clic en "+ Nuevo Registro".</td></tr>
                    ) : (() => {
                      // Agrupar por numero_ot para hacer rowspan
                      const grupos = []
                      const vistos = new Set()
                      for (const ot of otsFiltradas) {
                        const key = String(ot.numero_ot)
                        if (!vistos.has(key)) {
                          vistos.add(key)
                          const parOTs = otsFiltradas.filter(o => String(o.numero_ot) === key)
                          grupos.push(parOTs)
                        }
                      }
                      return grupos.flatMap((par, gi) => {
                        const fact = par.find(o => o.actividad === act1)
                        const inst = par.find(o => o.actividad === act2)
                        const ref = fact || inst
                        if (!ref) return []
                        const rowSpan = fact && inst ? 2 : 1
                        const borderBottom = '2px solid #1e3a5f'

                        const celdaSpan = (content, extraStyle = {}) => (
                          <td rowSpan={rowSpan} style={{ borderBottom, verticalAlign: 'middle', ...extraStyle }}>
                            {content}
                          </td>
                        )

                        return [fact, inst].filter(Boolean).map((ot, idx) => {
                          const esFirst = idx === 0
                          const esLast = idx === (fact && inst ? 1 : 0)
                          const info = getEstadoInfo(ot.estado)
                          const pct = Math.round((ot.progreso || 0) * 100)
                          const efInfo = getEficienciaLabel(ot.eficiencia)
                          const rowBorder = esLast ? '2px solid #1e3a5f' : 'none'
                          return (
                            <tr key={`${gi}-${ot.id}`} className={!esLast ? 'ot-mid-row' : ''}>
                              {modoEliminar && esFirst && celdaSpan(<input type="checkbox" className="accent-blue-500" checked={seleccionados.has(ref.id)} onChange={() => {
                                setSeleccionados(prev => {
                                  const next = new Set(prev)
                                  const ids = [fact?.id, inst?.id].filter(Boolean)
                                  if (next.has(ref.id)) ids.forEach(id => next.delete(id))
                                  else ids.forEach(id => next.add(id))
                                  return next
                                })
                              }} />)}
                              {todasColsOrdenadas.map(col => {
                                const k = col.key
                                // Columnas con rowspan — solo se renderizan en la primera fila
                                if (['numero_registro','contratista','contrato'].includes(k)) {
                                  if (!esFirst) return null
                                  if (k === 'numero_registro') return <td key={k} rowSpan={rowSpan} style={{minWidth:90,width:90,padding:'4px 8px',textAlign:'center',background:'#0d1526',borderRight:'2px solid #1e293b',position:'sticky',left:0,zIndex:1,borderBottom,verticalAlign:'middle'}}><span className="font-mono font-bold text-blue-400" style={{fontSize:'13px'}}>{`OT-${String(ref.numero_ot).padStart(2,'0')}`}</span></td>
                                  if (k === 'contratista') return <td key={k} rowSpan={rowSpan} style={{borderBottom,verticalAlign:'middle'}}><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:ref._cont?.color||'#666'}}/><span className="text-xs">{ref._cont?.nombre||'—'}</span></div></td>
                                  if (k === 'contrato') return <td key={k} rowSpan={rowSpan} style={{borderBottom,verticalAlign:'middle'}}><span className="text-xs text-gray-500">{ref.contrato||ref._cont?.contrato||'—'}</span></td>
                                }
                                if (k === 'inst_seguim') return null
                                if (k === 'inst_doc') return null
                                if (k === 'inst_editar') return null
                                if (k === 'acciones') {
                                  if (!esFirst) return null
                                  return <td key="acc" rowSpan={rowSpan} style={{verticalAlign:'middle',padding:'4px 8px',borderLeft:'2px solid #1e3a5f',background:'#0a1628',width:90,minWidth:90}}><div className="flex gap-1">{!modoEliminar?<><BotonDocumento onWord={()=>generarWordDirecto(fact||inst)} onPdf={()=>generarPdfDirecto(fact||inst)}/><button className="btn-ghost text-xs py-1 px-2" title="Seguimiento" onClick={()=>{setOtSeg({fact, inst}); setModalSegInst(true)}} style={{color:'#60a5fa',borderColor:'#1e3a5f'}}>📊</button></>:<button className={`text-xs py-1 px-2 rounded ${seleccionados.has(ref.id)?'text-red-400':'text-gray-600'}`} onClick={()=>{
                    // Seleccionar/deseleccionar fact e inst juntos
                    setSeleccionados(prev => {
                      const next = new Set(prev)
                      const ids = [fact?.id, inst?.id].filter(Boolean)
                      if (next.has(ref.id)) ids.forEach(id => next.delete(id))
                      else ids.forEach(id => next.add(id))
                      return next
                    })
                  }}>{seleccionados.has(ref.id)?'☑':'☐'}</button>}</div></td>
                                }
                                if (k === 'actividad') {
                                  const esAct2 = ot.actividad === act2
                                  return <td key={k}><span style={{display:'inline-block',padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:600,border:`1px solid ${esAct2?'#7c3aed':'#0e7490'}`,background:esAct2?'#1a0f33':'#083344',color:esAct2?'#c084fc':'#06b6d4'}}>{esAct2?actLabel(act2):actLabel(act1)}</span></td>
                                }
                                if (k === 'semana') return <td key={k} className="text-xs text-gray-400">{ot.semana||'—'}</td>
                                if (k === 'progreso') return <td key={k}><div className="flex items-center gap-2"><div className="prog-bar"><div className="prog-fill" style={{width:`${pct}%`}}/></div><span className="text-xs font-mono">{pct}%</span></div></td>
                                if (k === 'fecha_inicio') return <td key={k} className="font-mono text-xs">{fmtFecha(ot.fecha_inicio)}</td>
                                if (k === 'fecha_fin_trabajos') return <td key={k} className="font-mono text-xs">{fmtFecha(ot.fecha_fin_trabajos)}</td>
                                if (k === 'fecha_limite') return <td key={k} className="font-mono text-xs font-semibold">{fmtFecha(ot.fecha_limite_expedientes)}</td>
                                if (k === 'fecha_entrega_ot') return <td key={k} className="font-mono text-xs">{fmtFecha(ot.datos_extra?.doc_fecha_entrega)}</td>
                                if (k === 'dias_plazo') return <td key={k} className="text-center font-mono text-xs">{ot.dias_plazo??'—'}</td>
                                if (k === 'cantidad') return <td key={k} className="text-center text-xs">{ot.cantidad_programada??'—'}</td>
                                if (k === 'cantidad_entregada') {
                                  const prog = ot.cantidad_programada > 0 && ot.cantidad_entregada !== null ? Math.round(ot.cantidad_entregada / ot.cantidad_programada * 100) : null
                                  return <td key={k} className="text-center text-xs"><span>{ot.cantidad_entregada??'—'}</span>{prog!==null&&<span className="ml-1 text-xs font-mono" style={{color:prog>=100?'#22c55e':prog>=80?'#eab308':'#ef4444'}}>({prog}%)</span>}</td>
                                }
                                if (k === 'fecha_reporte') return <td key={k} className="font-mono text-xs" style={{color:{1:'#22c55e',2:'#f97316',3:'#60a5fa',4:'#eab308',5:'#ef4444'}[ot.estado]||'#6b7280'}}>{fmtFecha(ot.fecha_reporte)}</td>
                                if (k === 'estado') return <td key={k}><span style={{color:{1:'#22c55e',2:'#f97316',3:'#60a5fa',4:'#eab308',5:'#ef4444'}[ot.estado]||'#6b7280',fontSize:'11px',fontWeight:600,whiteSpace:'nowrap'}}>{info.label}</span></td>
                                if (k === 'duracion_real') return <td key={k} className="text-center font-mono text-xs">{ot.duracion_real??'—'}</td>
                                if (k === 'dias_fuera') return <td key={k} className="text-center font-mono text-xs" style={{color:(ot.dias_fuera_plazo||0)>0?'#ef4444':'#6b7280'}}>{ot.dias_fuera_plazo||0}</td>
                                if (k === 'val_pen') return <td key={k} className="font-mono text-xs text-right" style={{color:(ot.val_penalidades_manual||0)>0?'#fbbf24':'#6b7280'}}>{(ot.val_penalidades_manual||0)>0?fmtMoneda(ot.val_penalidades_manual):'—'}</td>
                                if (k === 'val_total') return <td key={k} className="font-mono text-xs text-right" style={{color:(ot.val_total_penalidad||0)>0?'#ef4444':'#6b7280'}}>{(ot.val_total_penalidad||0)>0?fmtMoneda(ot.val_total_penalidad):'—'}</td>
                                if (k === 'observaciones') return <td key={k} className="text-xs text-gray-500">{ot.observaciones||'—'}</td>
                                if (k === 'eficiencia') return <td key={k} className="text-xs font-mono font-semibold" style={{color:efInfo.color}}>{efInfo.label}</td>
                                if (k === 'accion_doc') return <td key={k}>{tienePlantilla?<BotonDocumento onWord={()=>generarWordDirecto(ot)} onPdf={()=>generarPdfDirecto(ot)}/>:'—'}</td>
                                if (k.startsWith('extra_')) { const campo = camposExtra.find(c => `extra_${c.id}` === k); return <td key={k} className="text-xs text-gray-400">{campo?(ot.datos_extra?.[campo.clave]??'—'):'—'}</td> }
                                return null
                              })}
                            </tr>
                          )
                        })
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'gantt' && <GanttModulo ots={otsFiltradas} contratistas={contratistas} modulo={modulo} />}

        {/* ── FERIADOS Y CAPACIDAD ── */}
        {tab === 'feriados' && (
          <div className="max-w-3xl space-y-6">

            {/* Capacidad diaria de trabajo */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm font-semibold text-white">⚡ Capacidad diaria de trabajo</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Define cuántas unidades puede procesar el equipo por día hábil en cada actividad. Este valor se usa para calcular automáticamente las fechas de fin de trabajo.</p>

              {/* Selector de actividad */}
              <div className="flex gap-2 mb-4">
                {[
                  { key: 'fact', label: 'Factibilidades', color: '#06b6d4', bg: '#083344', border: '#0e7490' },
                  { key: 'inst', label: actLabelLong(act2), color: '#c084fc', bg: '#1a0f33', border: '#7c3aed' },
                ].map(a => (
                  <button key={a.key} onClick={() => { setCapTab(a.key); setCapValor(String(capacidades[a.key])) }}
                    className="px-4 py-2 rounded-lg text-xs font-semibold border transition-all"
                    style={capTab === a.key
                      ? { background: a.bg, color: a.color, borderColor: a.border }
                      : { background: 'transparent', color: '#5c7a9e', borderColor: '#1e293b' }}>
                    {a.label}
                  </button>
                ))}
              </div>

              {capTab && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">
                      Capacidad diaria — {capTab === 'fact' ? actLabelLong(act1) : actLabelLong(act2)}
                    </label>
                    <input type="text" inputMode="numeric"
                      className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-sm font-bold outline-none focus:border-cyan-500"
                      value={capValor} onChange={e => setCapValor(e.target.value)} />
                    <p className="text-xs text-gray-600 mt-1">Actualmente: {capacidades[capTab]} unidades/día</p>
                  </div>
                  <button disabled={savingCap} onClick={async () => {
                    setSavingCap(true)
                    const clave = capTab === 'fact' ? 'inst_capacidad_fact' : 'inst_capacidad_inst'
                    await supabase.from('config_global').upsert({ clave, valor: capValor, descripcion: `Capacidad diaria ${capTab === 'fact' ? actLabelLong(act1) : actLabelLong(act2)}` })
                    setCapacidades(p => ({ ...p, [capTab]: parseInt(capValor)||p[capTab] }))
                    setSavingCap(false)
                    setCapTab(null)
                  }} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#06b6d4', color: '#000' }}>
                    {savingCap ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              )}
            </div>

            {/* Feriados nacionales y locales */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">📅 Feriados nacionales y locales</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Establece los feriados nacionales y locales que se excluirán del cálculo de fechas. Los feriados locales también consideran días especiales de la región Puno.</p>

              {/* Agregar feriado */}
              <div className="flex gap-2 mb-4 items-end">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Fecha</label>
                  <input type="date" className="px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={feriadoNuevo.fecha} onChange={e => setFeriadoNuevo(p => ({ ...p, fecha: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tipo</label>
                  <select className="px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none"
                    value={feriadoNuevo.tipo} onChange={e => setFeriadoNuevo(p => ({ ...p, tipo: e.target.value }))}>
                    <option value="nacional">Nacional</option>
                    <option value="local">Local (Puno)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1">Descripción</label>
                  <input className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    placeholder="Ej: Navidad" value={feriadoNuevo.descripcion}
                    onChange={e => setFeriadoNuevo(p => ({ ...p, descripcion: e.target.value }))} />
                </div>
                <button disabled={savingFer || !feriadoNuevo.fecha} onClick={async () => {
                  setSavingFer(true)
                  const { data } = await supabase.from('feriados').insert({ fecha: feriadoNuevo.fecha, tipo: feriadoNuevo.tipo, descripcion: feriadoNuevo.descripcion }).select().single()
                  if (data) setFeriados(p => [...p, data].sort((a,b) => a.fecha.localeCompare(b.fecha)))
                  setFeriadoNuevo({ fecha: '', tipo: 'nacional', descripcion: '' })
                  setSavingFer(false)
                }} className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: '#06b6d4', color: '#000' }}>
                  {savingFer ? '...' : '+ Agregar'}
                </button>
              </div>

              {/* Lista de feriados agrupados por año */}
              {Object.entries(
                feriados.reduce((acc, f) => {
                  const anio = f.fecha?.slice(0,4) || '—'
                  if (!acc[anio]) acc[anio] = []
                  acc[anio].push(f)
                  return acc
                }, {})
              ).sort(([a],[b]) => b.localeCompare(a)).map(([anio, lista]) => (
                <div key={anio} className="mb-4">
                  <div className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">{anio}</div>
                  <div className="space-y-1">
                    {lista.map(f => (
                      <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: '#0a1220' }}>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gray-300">{f.fecha}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${f.tipo === 'nacional' ? 'bg-blue-950 text-blue-400' : 'bg-purple-950 text-purple-400'}`}>
                            {f.tipo === 'nacional' ? 'Nacional' : 'Local'}
                          </span>
                          <span className="text-xs text-gray-400">{f.descripcion}</span>
                        </div>
                        <button onClick={async () => {
                          await supabase.from('feriados').delete().eq('id', f.id)
                          setFeriados(p => p.filter(x => x.id !== f.id))
                        }} className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-red-950 transition-all">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {feriados.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-6">No hay feriados registrados.</p>
              )}
            </div>
          </div>
        )}

        {/* ── CAMPOS — con preview estilo Excel ── */}
        {tab === 'campos' && (
          <div className="max-w-4xl space-y-4">
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-300">Vista previa</span>
                <span className="text-xs text-gray-600">{camposOrden.length + 2} columnas</span>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="flex gap-1 items-end flex-nowrap min-w-max">
                  {[{key:'numero_registro',label:'N° Reg.'},...camposOrden,{key:'acciones',label:'Acciones'}].map((c,i)=>(
                    <div key={c.key+i} className="flex flex-col items-center gap-1">
                      <div className="text-xs font-bold px-2 py-0.5 rounded text-center"
                        style={{background:['numero_registro','acciones'].includes(c.key)?'#1f2937':c.key.startsWith('extra_')?'#3b1f6b':'#1e3a5f',color:['numero_registro','acciones'].includes(c.key)?'#6b7280':c.key.startsWith('extra_')?'#c4b5fd':'#93c5fd',border:'1px solid #2d4a6b',minWidth:28}}>
                        {colLetra(i)}
                      </div>
                      <div className="text-xs text-center px-1.5 py-1 rounded"
                        style={{background:['numero_registro','acciones'].includes(c.key)?'#111827':c.key.startsWith('extra_')?'#1e1b4b':'#0f172a',color:['numero_registro','acciones'].includes(c.key)?'#4b5563':c.key.startsWith('extra_')?'#a78bfa':'#d1d5db',border:'1px solid #374151',maxWidth:68,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                        title={c.label}>{c.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-4 mt-1.5 text-xs text-gray-600"><span>🔵 Base</span><span>🟣 Personalizada</span><span>⬜ Fija</span></div>
            </div>
            <div className="grid grid-cols-5 gap-4">
              <div className="card col-span-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide">Orden de columnas</h3>
                  <button className="btn-primary text-xs" onClick={()=>setModalCampo(true)}>+ Campo personalizado</button>
                </div>
                <p className="text-xs text-gray-600 mb-3">↑↓ reordena · ✕ desactiva · 🗑️ elimina personalizada</p>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {camposOrden.map((col,idx)=>{
                    const isExtra=col.key.startsWith('extra_')
                    const isFixed=['estado','fecha_limite'].includes(col.key)
                    const campo=isExtra?camposExtra.find(c=>`extra_${c.id}`===col.key):null
                    return (
                      <div key={col.key+idx} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${isExtra?'border-purple-900 bg-purple-950':'border-blue-900 bg-blue-950'}`}>
                        <span className="text-xs font-bold w-6 text-center font-mono flex-shrink-0" style={{color:isExtra?'#c4b5fd':'#93c5fd'}}>{colLetra(idx+1)}</span>
                        <span className={`text-xs flex-1 ${isExtra?'text-purple-200':'text-gray-200'}`}>{col.label}</span>
                        {isFixed&&<span className="text-xs text-gray-600">fija</span>}
                        {isExtra&&campo&&<span className="text-xs text-purple-500 bg-purple-900 px-1.5 py-0.5 rounded">{campo.tipo}</span>}
                        <div className="flex gap-0.5 ml-1">
                          <button className="text-gray-600 hover:text-gray-200 px-1 text-xs rounded hover:bg-gray-800" onClick={()=>moverEnCampos(idx,-1)} disabled={idx===0}>↑</button>
                          <button className="text-gray-600 hover:text-gray-200 px-1 text-xs rounded hover:bg-gray-800" onClick={()=>moverEnCampos(idx,1)} disabled={idx===camposOrden.length-1}>↓</button>
                          {!isFixed&&(isExtra
                            ?<button className="text-red-600 hover:text-red-400 px-1 text-xs rounded hover:bg-red-950" onClick={()=>campo&&eliminarCampo(campo.id)}>🗑️</button>
                            :<button className="text-red-600 hover:text-red-400 px-1 text-xs rounded hover:bg-red-950" title="Desactivar" onClick={()=>desactivarColEnCampos(idx)}>✕</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="card col-span-2">
                <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wide mb-2">Columnas disponibles</h3>
                <p className="text-xs text-gray-600 mb-3">Clic para activar al final.</p>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {CAMPOS_BASE.filter(c=>{
                    if(c.key==='val_pen'||c.key==='val_total') return modulo.tiene_penalidad
                    if(c.key==='contratista') return contratistas.length>0
                    return true
                  }).filter(c=>!camposOrden.find(a=>a.key===c.key)&&c.key!=='numero_registro').map(col=>(
                    <button key={col.key} onClick={()=>activarColEnCampos(col.key)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-gray-800 hover:border-blue-700 hover:bg-blue-950 text-left transition-all">
                      <span className="text-blue-500 text-xs font-bold">+</span>
                      <span className="text-xs text-gray-400 flex-1">{col.label}</span>
                      {col.key==='val_total'&&<span className="text-xs text-yellow-600">💰</span>}
                      {col.key==='accion_doc'&&<span className="text-xs text-blue-600">📄</span>}
                    </button>
                  ))}
                  {CAMPOS_BASE.filter(c=>{
                    if(c.key==='val_pen'||c.key==='val_total') return modulo.tiene_penalidad
                    if(c.key==='contratista') return contratistas.length>0
                    return true
                  }).filter(c=>!camposOrden.find(a=>a.key===c.key)&&c.key!=='numero_registro').length===0&&(
                    <div className="text-xs text-gray-600 py-3 text-center">Todas las columnas están activas</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL OT — Instalaciones Nuevas usa ModalInstOT ── */}
      {/* Modal de descarga */}
      <ModalDescarga status={docToast?.msg} onClose={() => setDocToast(null)} />

      {modalOpen && (
        <ModalInstOT
          modulo={modulo}
          contratistas={contratistas}
          par={editando ? ots.filter(o => o.numero_ot === editando.numero_ot) : null}
          anioActivo={anioSelec}
          onClose={() => { setModalOpen(false); cargar() }}
          onSaved={(esNueva) => { if (!esNueva) { setModalOpen(false) }; cargar() }}
          capacidades={capacidades}
          feriadosDB={feriados}
          onDocStatus={(s) => mostrarToast(s)}
          act1={act1}
          act2={act2}
        />
      )}

      {/* ── MODAL IMPORTAR EXCEL ── */}
      {modalImport && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-2xl border border-gray-700 p-6 w-full max-w-md" style={{ background: '#0f1a2e' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">⬆️ Importar OTs</h3>
              <button onClick={() => { setModalImport(false); setImportFile(null); setImportResult(null) }}
                className="text-gray-500 hover:text-white">✕</button>
            </div>

            {!importResult ? (
              <>
                <div className="mb-4 p-3 rounded-lg text-xs text-gray-400" style={{ background: '#0a1220', border: '1px solid #1e3a5f' }}>
                  <p className="font-semibold text-blue-400 mb-1">📄 {importFile?.name}</p>
                  <p>El sistema reconocerá automáticamente las columnas aunque los nombres varíen.</p>
                  <p className="mt-1">Las OTs que ya existen se omitirán. El estado lo asigna el sistema.</p>
                </div>

                <div className="mb-4">
                  <label className="text-xs text-gray-400 block mb-1">Contratista <span className="text-cyan-400">*</span></label>
                  <select className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                    value={importContratista} onChange={e => setImportContratista(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {contratistas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <p className="text-xs text-gray-600 mt-1">Se asignará a todas las OTs importadas.</p>
                </div>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setModalImport(false); setImportFile(null) }}
                    className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800">
                    Cancelar
                  </button>
                  <button onClick={ejecutarImport} disabled={importando || !importContratista}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#06b6d4', color: '#000' }}>
                    {importando ? '⏳ Importando...' : '⬆️ Importar'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {importResult.error ? (
                  <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-xs text-red-300 mb-4">
                    ❌ {importResult.error}
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    <div className="p-3 rounded-lg text-xs" style={{ background: '#052e16', border: '1px solid #166534' }}>
                      <p className="text-green-400 font-semibold">
                        ✅ {importResult.ok} fila(s) importadas de {(importResult.total || 0) * 2} ({importResult.total} OTs)
                      </p>
                    </div>
                    {importResult.advertencias?.length > 0 && (
                      <div className="p-3 rounded-lg text-xs max-h-32 overflow-y-auto" style={{ background: '#1c1200', border: '1px solid #854d0e' }}>
                        <p className="text-yellow-400 font-semibold mb-1">⚠️ Advertencias:</p>
                        {importResult.advertencias.map((a, i) => <p key={i} className="text-yellow-300 mt-0.5">· {a}</p>)}
                      </div>
                    )}
                    {importResult.errores?.length > 0 && (
                      <div className="p-3 rounded-lg text-xs max-h-32 overflow-y-auto" style={{ background: '#1c0101', border: '1px solid #991b1b' }}>
                        <p className="text-red-400 font-semibold mb-1">❌ Errores:</p>
                        {importResult.errores.map((e, i) => <p key={i} className="text-red-300 mt-0.5">· {e}</p>)}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => { setModalImport(false); setImportFile(null); setImportResult(null) }}
                  className="w-full py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800">
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
      {/* Modal confirmar eliminar */}
      {confirmEliminar && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-2xl border border-red-800 p-6 w-full max-w-sm text-center" style={{ background: '#0f1a2e' }}>
            <div style={{ fontSize: 36 }} className="mb-3">🗑️</div>
            <p className="text-white font-semibold text-sm mb-1">¿Eliminar {Math.ceil(seleccionados.size / 2)} OT(s) seleccionada(s)?</p>
            <p className="text-gray-400 text-xs mb-4">Se eliminarán todas sus actividades ({actLabelLong(act1)} e {actLabelLong(act2)}). Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmEliminar(false)}
                className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={confirmarEliminar}
                className="flex-1 py-2 rounded-lg text-xs font-semibold"
                style={{ background: '#dc2626', color: '#fff' }}>
                Eliminar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {modalSegInst && otSeg && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-2xl border border-gray-700 p-6 w-full max-w-sm" style={{ background: '#0f1a2e' }}>
            {!segActSelec ? (
              <>
                <h3 className="text-sm font-bold text-white mb-1">📊 Seguimiento</h3>
                <p className="text-xs text-gray-500 mb-4">OT-{String(otSeg.fact?.numero_ot).padStart(2,'0')} · ¿Qué actividad deseas reportar?</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => { setSegActSelec('fact'); setSegFecha(otSeg.fact?.fecha_reporte||''); setSegCant(String(otSeg.fact?.cantidad_entregada||'')) }}
                    className="w-full py-3 rounded-xl border text-xs font-semibold text-left px-4 transition-all hover:brightness-110"
                    style={{ background: '#083344', borderColor: '#0e7490', color: '#06b6d4' }}>
                    {actLabelLong(act1)}
                    {otSeg.fact?.fecha_reporte && <span className="ml-2 text-gray-500 font-normal">· {otSeg.fact.fecha_reporte}</span>}
                  </button>
                  {otSeg.inst && (
                    <button onClick={() => { setSegActSelec('inst'); setSegFecha(otSeg.inst?.fecha_reporte||''); setSegCant(String(otSeg.inst?.cantidad_entregada||'')) }}
                      className="w-full py-3 rounded-xl border text-xs font-semibold text-left px-4 transition-all hover:brightness-110"
                      style={{ background: '#1a0f33', borderColor: '#7c3aed', color: '#c084fc' }}>
                      {actLabelLong(act2)}
                      {otSeg.inst?.fecha_reporte && <span className="ml-2 text-gray-500 font-normal">· {otSeg.inst.fecha_reporte}</span>}
                    </button>
                  )}
                </div>
                <button onClick={() => { setModalSegInst(false); setOtSeg(null); setSegActSelec(null) }}
                  className="w-full mt-4 py-2 rounded-lg border border-gray-700 text-gray-400 text-xs hover:bg-gray-800">Cancelar</button>
              </>
            ) : (
              <>
                <button onClick={() => setSegActSelec(null)} className="text-xs text-gray-500 hover:text-gray-300 mb-3 flex items-center gap-1">← Volver</button>
                <h3 className="text-sm font-bold text-white mb-1">
                  {segActSelec === 'fact' ? `📊 Seguimiento — ${actLabelLong(act1)}` : `📊 Seguimiento — ${actLabelLong(act2)}`}
                </h3>
                <p className="text-xs text-gray-500 mb-4">OT-{String(otSeg.fact?.numero_ot).padStart(2,'0')}</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Fecha de reporte</label>
                    <input type="date" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                      value={segFecha} onChange={e => setSegFecha(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Cantidad entregada</label>
                    <input type="text" inputMode="numeric" className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-white text-xs outline-none focus:border-cyan-500"
                      placeholder="0" value={segCant} onChange={e => setSegCant(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setModalSegInst(false); setOtSeg(null); setSegActSelec(null) }}
                    className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800">Cancelar</button>
                  <button disabled={savingSeg || !segFecha} onClick={async () => {
                    setSavingSeg(true)
                    const otId = segActSelec === 'fact' ? otSeg.fact?.id : otSeg.inst?.id
                    await supabase.from('ots').update({ fecha_reporte: segFecha, cantidad_entregada: parseInt(segCant)||null }).eq('id', otId)
                    setSavingSeg(false)
                    setModalSegInst(false); setOtSeg(null); setSegActSelec(null); setSegFecha(''); setSegCant('')
                    cargar()
                  }} className="flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#06b6d4', color: '#000' }}>
                    {savingSeg ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
      {modalSeg && otSeg && (
        <ModalSeguimiento
          ot={otSeg}
          modulo={modulo}
          contratistas={contratistas}
          periodo={periodo}
          onClose={() => { setModalSeg(false); setOtSeg(null) }}
          onSave={() => { setModalSeg(false); setOtSeg(null); cargar() }} />
      )}

      {/* ── MODAL NUEVO CAMPO ── */}
      {modalCampo && (
        <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setModalCampo(false)}}>
          <div className="modal-box" style={{maxWidth:500}}>
            <div className="modal-header">
              <h2 className="text-base font-bold text-white">➕ Nueva columna personalizada</h2>
              <button onClick={()=>setModalCampo(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre de la columna *</label>
                <input className="input-base" placeholder="Ej: Zona, N° Suministro, Resultado..."
                  value={nuevoCampo.nombre}
                  onChange={e=>setNuevoCampo(p=>({...p,nombre:e.target.value,clave:e.target.value.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Tipo de dato</label>
                <div className="grid grid-cols-4 gap-2">
                  {[{v:'texto',icon:'📝',l:'Texto'},{v:'numero',icon:'🔢',l:'Número'},{v:'fecha',icon:'📅',l:'Fecha'},{v:'lista',icon:'📋',l:'Lista'}].map(t=>(
                    <button key={t.v} type="button" onClick={()=>setNuevoCampo(p=>({...p,tipo:t.v}))}
                      className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs font-medium transition-all ${nuevoCampo.tipo===t.v?'border-blue-500 bg-blue-950 text-blue-300':'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
                      <span className="text-lg">{t.icon}</span>{t.l}
                    </button>
                  ))}
                </div>
              </div>
              {nuevoCampo.tipo==='lista'&&(
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Opciones (separadas por coma)</label>
                  <input className="input-base" placeholder="Ej: Aprobado, Rechazado, Pendiente"
                    value={nuevoCampo.opciones} onChange={e=>setNuevoCampo(p=>({...p,opciones:e.target.value}))} />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">📍 ¿Dónde insertarla?</label>
                <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-800 rounded-lg p-2 bg-gray-900">
                  <button type="button"
                    className={`w-full text-left text-xs px-3 py-1.5 rounded transition-all ${nuevoCampo.insertarEn===-1?'bg-purple-900 text-purple-200 border border-purple-600':'text-gray-400 hover:bg-gray-800'}`}
                    onClick={()=>setNuevoCampo(p=>({...p,insertarEn:-1}))}>↖ Al inicio (primera columna)</button>
                  {todasColsOrdenadas.filter(c=>c.key!=='acciones'&&c.key!=='numero_registro').map((col,idx)=>{
                    const isExtra=col.key.startsWith('extra_')
                    return (
                      <button key={col.key} type="button"
                        className={`w-full text-left text-xs px-3 py-1.5 rounded transition-all flex items-center gap-2 ${nuevoCampo.insertarEn===idx?'bg-purple-900 text-purple-200 border border-purple-600':'text-gray-400 hover:bg-gray-800'}`}
                        onClick={()=>setNuevoCampo(p=>({...p,insertarEn:idx}))}>
                        <span className="font-mono font-bold text-xs flex-shrink-0" style={{color:isExtra?'#c4b5fd':'#93c5fd',minWidth:20}}>{colLetra(idx+1)}</span>
                        <span className="flex-1">{col.label}</span>
                        {isExtra&&<span className="text-purple-500 text-xs">personalizada</span>}
                        <span className="text-gray-600 text-xs">→ después</span>
                      </button>
                    )
                  })}
                  <button type="button"
                    className={`w-full text-left text-xs px-3 py-1.5 rounded transition-all ${nuevoCampo.insertarEn===-2?'bg-purple-900 text-purple-200 border border-purple-600':'text-gray-400 hover:bg-gray-800'}`}
                    onClick={()=>setNuevoCampo(p=>({...p,insertarEn:-2}))}>↘ Al final</button>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {nuevoCampo.insertarEn===-1?'→ Primera posición':nuevoCampo.insertarEn===-2?'→ Al final':`→ Después de "${todasColsOrdenadas.filter(c=>c.key!=='acciones'&&c.key!=='numero_registro')[nuevoCampo.insertarEn]?.label||''}"`}
                </p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-blue-500" checked={nuevoCampo.obligatorio}
                  onChange={e=>setNuevoCampo(p=>({...p,obligatorio:e.target.checked}))} />
                <span className="text-xs text-gray-300">Campo obligatorio al crear un registro</span>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={()=>setModalCampo(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarCampo} disabled={!nuevoCampo.nombre}>💾 Agregar columna</button>
            </div>
          </div>
        </div>
      )}

      {modalDoc && otParaDoc && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalDoc(false) }}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-bold text-white">📄 Generar Documento</h2>
                <p className="text-xs text-gray-500 mt-0.5">{esOT ? `OT #${idPrincipal(otParaDoc)}` : `Reg. #${otParaDoc.numero_registro}`} · {otParaDoc.actividad}</p>
              </div>
              <button onClick={() => setModalDoc(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* Resumen precargado */}
              <div className="p-3 rounded-xl border border-gray-800 bg-gray-900 space-y-1.5 text-xs">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Datos precargados del registro</div>
                {[
                  ['N° OT', docForm.numero_ot],
                  ['Código OT', docForm.codigo_ot],
                  ['Contrato', docForm.contrato],
                  ['Semana', docForm.semana],
                  ['Fecha inicio', docForm.fecha_inicio],
                  ['Fecha límite', docForm.fecha_limite],
                  ['Días plazo', docForm.dias_plazo],
                  ['Cantidad', docForm.cantidad],
                  ['Contratista', docForm.contratista_nombre],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-gray-600">{k}</span>
                    <span className="text-gray-300 font-mono text-right truncate max-w-52">{v}</span>
                  </div>
                ))}
              </div>

              {/* Solo los campos ajustables */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ajustes del documento</div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">📅 Fecha entrega OT <span className="text-gray-600 font-normal">(cuándo debe entregarse)</span></label>
                  <input className="input-base" type="date" value={docForm.fecha_entrega || ''} onChange={e => setDocForm(p => ({ ...p, fecha_entrega: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Coordinador (firma)</label>
                  <input className="input-base" placeholder="CONSORCIO SUPERVISOR" value={docForm.coordinador || ''} onChange={e => setDocForm(p => ({ ...p, coordinador: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha final de trabajo <span className="text-gray-600 font-normal">(opcional)</span></label>
                  <input className="input-base" type="date" value={docForm.fecha_fin || ''} onChange={e => setDocForm(p => ({ ...p, fecha_fin: e.target.value }))} />
                </div>
              </div>

              {/* Versión de firmas */}
              <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-xs font-semibold text-gray-300 mb-2">✍️ Versión de firmas</div>
                <div className="flex gap-2">
                  {[
                    { v: 'espacios', l: 'Con espacio para firmar' },
                    { v: 'firmado',  l: 'Con firmas reales' },
                  ].map(({ v, l }) => (
                    <label key={v} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer flex-1 transition-all ${versionFirma === v ? 'border-blue-600 bg-blue-950' : 'border-gray-800 hover:border-gray-700'}`}>
                      <input type="radio" className="accent-blue-500" checked={versionFirma === v} onChange={() => setVersionFirma(v)} />
                      <span className={`text-xs font-semibold ${versionFirma === v ? 'text-blue-300' : 'text-gray-400'}`}>{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModalDoc(false)}>Cancelar</button>
              <button className="btn-ghost" onClick={() => (async () => {
                    try {
                      const data = {
                        numero_ot: String(docForm.numero_ot||''), codigo_ot: String(docForm.codigo_ot||docForm.numero_ot||''),
                        contrato: String(docForm.contrato||''), fecha_entrega: docForm.fecha_entrega||'',
                        fecha_inicio: docForm.fecha_inicio||'', fecha_fin: docForm.fecha_fin||'',
                        fecha_limite: docForm.fecha_limite||'', dias_plazo: String(docForm.dias_plazo||'1'),
                        cantidad: String(docForm.cantidad||''), actividad_doc: String(docForm.actividad_doc||docForm.actividad_label||''),
                        actividad_label: String(docForm.actividad_label||''), cumplimiento: String(docForm.cumplimiento||''),
                        editado_por: String(docForm.editado_por||''), coordinador: String(docForm.coordinador||''),
                        contratista_nombre: String(docForm.contratista_nombre||''), motivo_extra: String(docForm.motivo_extra||''),
                        semana: String(docForm.semana||''), periodo: String(docForm.periodo||periodo||''), titulo: String(docForm.titulo||''),
                      }
                      const res = await fetch('/api/genword', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ modulo_id: modulo.id, actividad: otParaDoc.actividad, data }) })
                      if (!res.ok) { alert('Error al generar Word'); return }
                      const blob = await res.blob()

                      // Extrae el nombre real del archivo desde el header — window.open()
                      // ignora el Content-Disposition y el navegador asigna un nombre
                      // aleatorio (UUID) en vez del nombre descriptivo generado por la API.
                      const disposition = res.headers.get('Content-Disposition') || ''
                      // Prioriza filename* (UTF-8) sobre el ASCII de respaldo.
                      const mUtf8 = disposition.match(/filename\*=UTF-8''([^;]+)/)
                      const m = disposition.match(/filename="([^"]+)"/)
                      const filename = mUtf8 ? decodeURIComponent(mUtf8[1]) : (m ? m[1] : `OT_${data.numero_ot}_${otParaDoc.actividad}.docx`)

                      const url = URL.createObjectURL(blob)
                      const a   = document.createElement('a')
                      a.href = url
                      a.download = filename
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      setTimeout(() => URL.revokeObjectURL(url), 10000)
                    } catch(e) { alert('Error: ' + e.message) }
                  })()}>📝 Word (.docx)</button>
              <button className="btn-primary" onClick={async () => {
                try {
                  const data = { ...docForm, periodo: docForm.periodo || periodo, titulo: docForm.titulo || otParaDoc.actividad }
                  const res = await fetch('/api/genpdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modulo_id: modulo.id, actividad: otParaDoc.actividad, data }) })
                  if (!res.ok) { const e = await res.json().catch(()=>({})); alert('Error: ' + (e.error || res.statusText)); return }
                  const arrayBuffer = await res.arrayBuffer()
                  const blob = new Blob([arrayBuffer], { type: 'application/pdf' })

                  // Prioriza filename* (UTF-8) sobre el ASCII de respaldo —
                  // mismo fix aplicado al botón de Word.
                  const disposition = res.headers.get('Content-Disposition') || ''
                  const mUtf8 = disposition.match(/filename\*=UTF-8''([^;]+)/)
                  const mAscii = disposition.match(/filename="([^"]+)"/)
                  const filename = mUtf8 ? decodeURIComponent(mUtf8[1]) : (mAscii ? mAscii[1] : `OT_${docForm.codigo_ot || docForm.numero_ot}_${otParaDoc.actividad}.pdf`)

                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = filename
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  setTimeout(() => URL.revokeObjectURL(url), 2000)
                  setModalDoc(false)
                } catch(e) { alert('Error: ' + e.message) }
              }}>📥 PDF</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── BotonDocumento — un solo botón que abre una pequeña ventana con las
// opciones Word/PDF, en vez de un menú flotante (que podía cortarse cerca
// del borde inferior de la pantalla en filas bajas de la tabla).
function BotonDocumento({ onWord, onPdf }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <button className="btn-ghost text-xs py-1 px-2" title="Descargar documento" onClick={() => setAbierto(true)}>📄</button>
      {abierto && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setAbierto(false) }} style={{ zIndex: 60 }}>
          <div className="modal-box" style={{ maxWidth: 260 }}>
            <div className="modal-header">
              <h3 className="text-sm font-bold text-white">Descargar documento</h3>
              <button onClick={() => setAbierto(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800">✕</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-2">
              <button className="btn-ghost text-sm justify-center" onClick={() => { setAbierto(false); onWord() }}>📝 Word (.docx)</button>
              <button className="btn-ghost text-sm justify-center" onClick={() => { setAbierto(false); onPdf() }}>📥 PDF</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── SortTh — columna ordenable ────────────────────────────────────────────────
function SortTh({ k, label, sc, ts, onResize }) {
  const active = sc.key === k
  return (
    <th onClick={() => ts(k)} style={{ cursor: 'pointer', userSelect: 'none', position: 'relative' }}>
      {label}
      <span className="ml-1 text-xs" style={{ color: active ? '#60a5fa' : '#4b5563' }}>
        {active ? (sc.dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
      {onResize && <span className="col-resize-handle" onMouseDown={e => { e.stopPropagation(); onResize(e) }}/>}
    </th>
  )
}

// ── ColumnInsertStrip — selector visual de posición ────────────────────────────
function ColumnInsertStrip({ camposBase, isColVisible, camposExtra, orden, setOrden, nombre }) {
  const baseActivas = camposBase.filter(c => isColVisible(c.key))
  const extrasOrden = [...camposExtra].sort((a, b) => a.orden - b.orden)
  const totalCols = baseActivas.length + extrasOrden.length
  const insertPos = orden

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-0.5 items-center flex-nowrap p-2 bg-gray-900 rounded border border-gray-800 min-w-max">
        <button type="button" onClick={() => setOrden(0)}
          className={"flex-shrink-0 text-xs px-1.5 py-1.5 rounded border transition-all " + (insertPos === 0 ? 'border-purple-500 bg-purple-950 text-purple-300 font-bold' : 'border-dashed border-gray-700 text-gray-600 hover:border-purple-600')}>+</button>

        {baseActivas.map((col, i) => (
          <div key={"base_" + col.key} className="flex items-center gap-0.5 flex-shrink-0">
            <div className="text-xs px-2 py-1.5 rounded" style={{ background: '#0f172a', border: '1px solid #374151', color: '#94a3b8' }}>
              <div className="text-blue-400 font-mono text-xs font-bold text-center">{colLetra(i)}</div>
              <div style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '9px' }}>{col.label}</div>
            </div>
            <button type="button" onClick={() => setOrden(i + 1)}
              className={"flex-shrink-0 text-xs px-1.5 py-1.5 rounded border transition-all " + (insertPos === i + 1 ? 'border-purple-500 bg-purple-950 text-purple-300 font-bold' : 'border-dashed border-gray-700 text-gray-600 hover:border-purple-600')}>+</button>
          </div>
        ))}

        {extrasOrden.map((c, i) => {
          const insertAfterThis = baseActivas.length + i + 1
          return (
            <div key={"extra_" + c.id} className="flex items-center gap-0.5 flex-shrink-0">
              <div className="text-xs px-2 py-1.5 rounded" style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a5b4fc' }}>
                <div className="font-mono text-xs font-bold text-center text-purple-400">{colLetra(baseActivas.length + i)}</div>
                <div style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '9px' }}>{c.nombre}</div>
              </div>
              <button type="button" onClick={() => setOrden(insertAfterThis)}
                className={"flex-shrink-0 text-xs px-1.5 py-1.5 rounded border transition-all " + (insertPos === insertAfterThis ? 'border-purple-500 bg-purple-950 text-purple-300 font-bold' : 'border-dashed border-gray-700 text-gray-600 hover:border-purple-600')}>+</button>
            </div>
          )
        })}

        {insertPos === totalCols && (
          <div className="flex-shrink-0 text-xs px-2 py-1.5 rounded font-semibold" style={{ background: '#4c1d95', border: '1px dashed #7c3aed', color: '#e9d5ff' }}>
            <div className="font-mono text-xs font-bold text-center text-purple-200">{colLetra(totalCols)}</div>
            <div style={{ maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '9px' }}>{nombre || '(nueva)'}</div>
          </div>
        )}
      </div>
      {insertPos < totalCols && (
        <div className="mt-1 text-xs text-purple-400">
          Posición <strong>{colLetra(insertPos)}</strong> entre{' '}
          <strong>{insertPos > 0 ? (insertPos <= baseActivas.length ? (baseActivas[insertPos - 1] ? baseActivas[insertPos - 1].label : '?') : (extrasOrden[insertPos - baseActivas.length - 1] ? extrasOrden[insertPos - baseActivas.length - 1].nombre : '?')) : 'inicio'}</strong>
          {' '}y{' '}
          <strong>{insertPos < baseActivas.length ? (baseActivas[insertPos] ? baseActivas[insertPos].label : '?') : (extrasOrden[insertPos - baseActivas.length] ? extrasOrden[insertPos - baseActivas.length].nombre : 'final')}</strong>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-1">Azul = columna base · Morado = personalizada</p>
    </div>
  )
}

// ── diasColor / diasLabel ─────────────────────────────────────────────────────
function diasColor(dias) {
  if (dias === null || dias === undefined) return '#6b7280'
  if (dias < 0) return '#ef4444'
  if (dias <= 3) return '#eab308'
  return '#6b7280'
}
function diasLabel(dias) {
  if (dias === null || dias === undefined) return ''
  if (dias < 0) return Math.abs(dias) + 'd atrás'
  return dias + 'd rest.'
}

// ── DashboardModulo ───────────────────────────────────────────────────────────
function Donut({ segs, size = 110, grosor = 22 }) {
  const r = (size - grosor) / 2, circ = 2 * Math.PI * r
  const cx = size / 2, cy = size / 2
  const total = segs.reduce((s, x) => s + x.n, 0)
  if (!total) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor}/>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="#4b5563" fontSize={9}>Sin datos</text>
    </svg>
  )
  let off = 0
  const arcos = segs.filter(s => s.n > 0).map(s => {
    const pct = s.n / total, dash = pct * circ
    const el = { ...s, dash, gap: circ - dash, offset: off * circ }
    off += pct; return el
  })
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={grosor}/>
      {arcos.map((a, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={grosor}
          strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={-a.offset} strokeLinecap="butt"/>
      ))}
    </svg>
  )
}

function BarH({ segs, total, h = 6 }) {
  if (!total) return <div style={{ height: h, background: '#1f2937', borderRadius: h/2 }}/>
  return (
    <div style={{ height: h, background: '#1f2937', borderRadius: h/2, overflow: 'hidden', display: 'flex' }}>
      {segs.filter(s => s.n > 0).map((s, i) => (
        <div key={i} style={{ width: `${s.n/total*100}%`, background: s.color }} title={`${s.label||''}: ${s.n}`}/>
      ))}
    </div>
  )
}

const C5 = { 1:'#22c55e', 2:'#f97316', 3:'#3b82f6', 4:'#eab308', 5:'#ef4444' }

function DashboardModulo({ ots, contratistas, modulo }) {
  if (ots.length === 0) return (
    <div className="flex items-center justify-center py-16 text-gray-600">
      <div className="text-center">
        <div className="text-3xl mb-2">📊</div>
        <div className="text-sm">Sin registros para mostrar estadísticas</div>
      </div>
    </div>
  )

  const esOT = modulo?.tipo === 'ot'
  const total = ots.length
  const mk = fn => ots.filter(fn).length

  const stats = {
    total,
    cumplidos:  mk(o => o.estado === 1 || o.estado === 2),
    a_tiempo:   mk(o => o.estado === 1),
    tarde:      mk(o => o.estado === 2),
    en_proceso: mk(o => o.estado === 3),
    por_vencer: mk(o => o.estado === 4),
    fuera:      mk(o => o.estado === 5),
    pen_total:  ots.reduce((s, o) => s + (o.val_total_penalidad || 0), 0),
    con_reporte: mk(o => !!o.fecha_reporte),
    sin_reporte: mk(o => !o.fecha_reporte),
  }
  const pct = total > 0 ? Math.round(stats.cumplidos / total * 100) : 0
  const pctATiempo = total > 0 ? Math.round(stats.a_tiempo / total * 100) : 0

  const segEstados = [
    { n: stats.a_tiempo,   color: C5[1], label: 'A tiempo'   },
    { n: stats.tarde,      color: C5[2], label: 'Tarde'      },
    { n: stats.en_proceso, color: C5[3], label: 'En proceso' },
    { n: stats.por_vencer, color: C5[4], label: 'Por vencer' },
    { n: stats.fuera,      color: C5[5], label: 'Fuera'      },
  ]

  // Por semana
  const xSemana = {}
  ots.forEach(o => {
    if (!o.semana) return
    if (!xSemana[o.semana]) xSemana[o.semana] = { total:0, a_tiempo:0, tarde:0, en_proceso:0, por_vencer:0, fuera:0 }
    xSemana[o.semana].total++
    if (o.estado===1) xSemana[o.semana].a_tiempo++
    if (o.estado===2) xSemana[o.semana].tarde++
    if (o.estado===3) xSemana[o.semana].en_proceso++
    if (o.estado===4) xSemana[o.semana].por_vencer++
    if (o.estado===5) xSemana[o.semana].fuera++
  })
  const semanas = Object.entries(xSemana).sort(([a],[b]) => a.localeCompare(b))
  const maxSem = Math.max(...semanas.map(([,v]) => v.total), 1)

  // Por contratista (solo módulos OT)
  const xCont = esOT ? contratistas.map(c => {
    const mis = ots.filter(o => o.contratista_id === c.id)
    return {
      ...c, total: mis.length,
      cumplidos:  mis.filter(o => o.estado===1||o.estado===2).length,
      en_proceso: mis.filter(o => o.estado===3||o.estado===4).length,
      fuera:      mis.filter(o => o.estado===5).length,
      pen:        mis.reduce((s,o) => s+(o.val_total_penalidad||0), 0),
    }
  }).filter(c => c.total > 0).sort((a,b) => b.total-a.total) : []

  // Eficiencia promedio (solo si tienen fecha_reporte)
  const conEfic = ots.filter(o => o.eficiencia !== null && o.eficiencia !== undefined)
  const eficProm = conEfic.length > 0 ? Math.round(conEfic.reduce((s,o) => s+(o.eficiencia||0),0)/conEfic.length) : null
  const eficInfo = eficProm !== null
    ? eficProm >= 90 ? { label:'Excelente', color:'#22c55e', grade:'A' }
    : eficProm >= 75 ? { label:'Bueno',     color:'#84cc16', grade:'B' }
    : eficProm >= 60 ? { label:'Regular',   color:'#eab308', grade:'C' }
    : eficProm >= 40 ? { label:'Deficiente',color:'#f97316', grade:'D' }
    : { label:'Crítico', color:'#ef4444', grade:'F' }
    : null

  return (
    <div className="space-y-4">

      {/* KPIs */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))' }}>
        {[
          { label: 'Total',        value: total,            color: '#3b82f6', icon: '📋', sub: `${stats.con_reporte} con reporte` },
          { label: 'Cumplieron',   value: stats.cumplidos,  color: '#22c55e', icon: '✅', sub: `${stats.a_tiempo} a tiempo · ${stats.tarde} tarde`, pct },
          { label: 'En proceso',   value: stats.en_proceso, color: '#3b82f6', icon: '●',  sub: 'dentro del plazo' },
          { label: 'Por vencer',   value: stats.por_vencer, color: '#eab308', icon: '⚡', sub: '≤ días configurados' },
          { label: 'Fuera de plazo',value: stats.fuera,     color: '#ef4444', icon: '❌', sub: 'sin reporte' },
          ...(esOT && stats.pen_total > 0 ? [{ label: 'Penalidades', value: `S/ ${stats.pen_total.toFixed(2)}`, color:'#f43f5e', icon:'💰', sub:'total acumulado', small:true }] : []),
          ...(eficInfo ? [{ label:'Eficiencia prom.', value:`${eficProm}`, color: eficInfo.color, icon:'📈', sub: eficInfo.label, small:true }] : []),
        ].map((k,i) => (
          <div key={i} className="card" style={{ borderTop:`2px solid ${k.color}`, padding:'12px 14px' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-sm">{k.icon}</span>
              <span className="text-xs text-gray-500 font-medium leading-tight">{k.label}</span>
            </div>
            <div className={`font-bold font-mono leading-none ${k.small ? 'text-sm' : 'text-2xl'}`} style={{ color: k.color }}>
              {k.value}
            </div>
            {k.pct !== undefined && (
              <div className="mt-1.5">
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-700">cumplimiento</span>
                  <span className="font-mono font-bold" style={{ color: k.color }}>{k.pct}%</span>
                </div>
                <div style={{ height:3, background:'#1f2937', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${k.pct}%`, background:k.color }}/>
                </div>
              </div>
            )}
            <div className="text-xs text-gray-700 mt-1 leading-tight">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Donut + Semanas */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '260px 1fr' }}>

        {/* Donut */}
        <div className="card" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">🍩 Distribución</div>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <Donut segs={segEstados} size={110} grosor={22}/>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-xl font-bold font-mono text-white leading-none">{pct}%</div>
                <div className="text-xs text-gray-500">cumplidos</div>
              </div>
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              {segEstados.map(s => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background:s.color }}/>
                  <span className="text-xs text-gray-400 flex-1 truncate">{s.label}</span>
                  <span className="text-xs font-mono font-bold flex-shrink-0" style={{ color:s.color }}>{s.n}</span>
                  {total > 0 && <span className="text-xs text-gray-700 flex-shrink-0" style={{ minWidth:28, textAlign:'right' }}>{Math.round(s.n/total*100)}%</span>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-700 mb-1">Distribución acumulada</div>
            <BarH segs={segEstados} total={total} h={7}/>
          </div>
        </div>

        {/* Por semana */}
        <div className="card">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📅 Por semana</div>
          {semanas.length === 0 ? (
            <div className="text-center py-6 text-gray-600 text-xs">Sin datos por semana</div>
          ) : (
            <>
              <div className="flex gap-3 mb-2 flex-wrap">
                {[['A tiempo',C5[1]],['Tarde',C5[2]],['En proceso',C5[3]],['Por vencer',C5[4]],['Fuera',C5[5]]].map(([l,c]) => (
                  <div key={l} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-sm" style={{ background:c }}/>
                    <span className="text-xs text-gray-600">{l}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {semanas.map(([sem,d]) => (
                  <div key={sem} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 flex-shrink-0 font-mono" style={{ width:76, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sem}</span>
                    <div className="flex-1">
                      <BarH segs={[
                        { n: d.a_tiempo   * (d.total/maxSem), color:C5[1] },
                        { n: d.tarde      * (d.total/maxSem), color:C5[2] },
                        { n: d.en_proceso * (d.total/maxSem), color:C5[3] },
                        { n: d.por_vencer * (d.total/maxSem), color:C5[4] },
                        { n: d.fuera      * (d.total/maxSem), color:C5[5] },
                      ]} total={d.total} h={18}/>
                    </div>
                    <span className="text-xs font-mono text-gray-500 flex-shrink-0" style={{ width:20, textAlign:'right' }}>{d.total}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Por contratista (solo OT) / Resumen de campos extra (libre) */}
      {esOT && xCont.length > 0 && (
        <div className="card">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">🏢 Por contratista</div>
          <div className="space-y-3">
            {xCont.map(c => {
              const pctC = c.total > 0 ? Math.round(c.cumplidos/c.total*100) : 0
              return (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:c.color||'#6b7280' }}/>
                      <span className="text-xs text-gray-300 truncate max-w-48">{c.nombre}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {c.pen > 0 && <span className="text-xs text-red-400 font-mono">S/{c.pen.toFixed(2)}</span>}
                      {c.fuera > 0 && <span className="text-xs font-mono" style={{ color:C5[5] }}>{c.fuera} fuera</span>}
                      <span className="text-xs font-mono font-bold" style={{ color: pctC>=80?C5[1]:pctC>=50?C5[4]:C5[5] }}>{pctC}%</span>
                    </div>
                  </div>
                  <BarH segs={[
                    { n:c.cumplidos,  color:'#22c55e', label:'Cumplidos'  },
                    { n:c.en_proceso, color:'#3b82f6', label:'En proceso' },
                    { n:c.fuera,      color:C5[5],     label:'Fuera'      },
                  ]} total={c.total} h={5}/>
                  <div className="text-xs text-gray-600 mt-0.5">{c.total} registros</div>
                </div>
              )
            })}
            {modulo.tiene_penalidad && stats.pen_total > 0 && (
              <div className="pt-3 border-t border-gray-800 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400">Total penalidades acumuladas</span>
                <span className="text-lg font-bold font-mono text-red-400">S/ {stats.pen_total.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Módulo libre — resumen simple */}
      {!esOT && (
        <div className="card">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📋 Resumen de registros</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label:'Con reporte',   value:stats.con_reporte,  color:'#22c55e', pct: total>0?Math.round(stats.con_reporte/total*100):0 },
              { label:'Sin reporte',   value:stats.sin_reporte,  color:'#6b7280', pct: total>0?Math.round(stats.sin_reporte/total*100):0 },
              { label:'Fuera de plazo',value:stats.fuera,         color:'#ef4444', pct: total>0?Math.round(stats.fuera/total*100):0 },
            ].map((r,i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-800" style={{ background:'#0d1526' }}>
                <div className="text-2xl font-bold font-mono leading-none" style={{ color:r.color }}>{r.value}</div>
                <div className="text-xs text-gray-500 mt-1">{r.label}</div>
                <div className="mt-2" style={{ height:3, background:'#1f2937', borderRadius:2 }}>
                  <div style={{ height:'100%', width:`${r.pct}%`, background:r.color, borderRadius:2 }}/>
                </div>
                <div className="text-xs text-gray-700 mt-0.5">{r.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
// ── ModalSeguimiento ──────────────────────────────────────────
function ModalSeguimiento({ ot, modulo, contratistas, periodo, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha_reporte:          ot.fecha_reporte || '',
    cantidad_entregada:     ot.cantidad_entregada ?? '',
    val_penalidades_manual: ot.val_penalidades_manual || '',
    observaciones:          ot.observaciones || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const cont          = contratistas.find(c => c.id === ot.contratista_id)
  const esOTmodulo    = modulo?.tipo === 'ot'
  const tieneCantidad = [1,2,3].includes(modulo?.id) && ot.cantidad_programada > 0
  const idLabel       = esOTmodulo ? `OT #${ot.numero_ot || ot.numero_registro}` : `Reg. #${ot.numero_registro}`

  const pctCant = tieneCantidad && form.cantidad_entregada !== ''
    ? Math.min(200, Math.round(parseInt(form.cantidad_entregada) / ot.cantidad_programada * 100))
    : null

  let estadoPreview = null
  if (form.fecha_reporte && ot.fecha_limite_expedientes) {
    const lim = new Date(ot.fecha_limite_expedientes + 'T00:00:00')
    const rep = new Date(form.fecha_reporte + 'T00:00:00')
    const dias = Math.round((rep - lim) / 86400000)
    estadoPreview = dias <= 0
      ? { label: '✓ A tiempo', color: '#22c55e' }
      : { label: `⚠ Tarde — ${dias}d fuera`, color: '#f97316' }
  }

  async function guardar() {
    if (!form.fecha_reporte) { setError('La fecha de reporte es requerida.'); return }
    setSaving(true)
    const { error: err } = await supabase.from('ots').update({
      fecha_reporte:          form.fecha_reporte || null,
      cantidad_entregada:     form.cantidad_entregada !== '' ? parseInt(form.cantidad_entregada) : null,
      val_penalidades_manual: form.val_penalidades_manual ? parseFloat(form.val_penalidades_manual) : 0,
      observaciones:          form.observaciones || null,
      actualizado_en:         new Date().toISOString(),
    }).eq('id', ot.id)
    if (err) { setError(err.message); setSaving(false); return }
    onSave()
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div style={{ background: '#1d4ed8', borderRadius: '12px 12px 0 0', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="text-sm font-bold text-white">📊 Registrar seguimiento</div>
            <div className="text-xs mt-0.5" style={{ color: '#bfdbfe' }}>
              {idLabel} · {modulo?.icono} {modulo?.nombre}
              {ot.actividad && ` · ${ot.actividad}`}
              {ot.semana && ` · ${ot.semana}`}
            </div>
          </div>
          <button onClick={onClose} className="text-white opacity-70 hover:opacity-100 text-xl w-7 h-7 flex items-center justify-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3 rounded-lg border border-gray-800 text-xs" style={{ background: '#0d1526' }}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-gray-500">Límite</div>
                <div className="font-mono font-bold text-gray-200 mt-0.5">
                  {ot.fecha_limite_expedientes
                    ? new Date(ot.fecha_limite_expedientes+'T00:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'})
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Programado</div>
                <div className="font-mono font-bold text-gray-200 mt-0.5">{ot.cantidad_programada || '—'}</div>
              </div>
              <div>
                <div className="text-gray-500">Contratista</div>
                <div className="font-mono text-gray-300 mt-0.5 truncate" style={{fontSize:10}}>{cont?.nombre?.split('–')[0]?.trim() || '—'}</div>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Fecha de reporte <span className="text-red-400">*</span></label>
            <input className="input-base" type="date" autoFocus
              value={form.fecha_reporte} onChange={e => setForm(p => ({ ...p, fecha_reporte: e.target.value }))} />
          </div>

          {tieneCantidad && (
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">
                Cantidad entregada <span className="text-gray-600 font-normal">de {ot.cantidad_programada} programadas</span>
              </label>
              <input className="input-base" type="number" min="0" placeholder="Ej: 100"
                value={form.cantidad_entregada} onChange={e => setForm(p => ({ ...p, cantidad_entregada: e.target.value }))} />
              {pctCant !== null && (
                <div className="mt-1.5">
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-600">Cumplimiento</span>
                    <span className="font-mono font-bold" style={{ color: pctCant>=100?'#22c55e':pctCant>=80?'#eab308':'#ef4444' }}>{pctCant}%</span>
                  </div>
                  <div style={{ height:4, background:'#1f2937', borderRadius:2, overflow:'hidden' }}>
                    <div style={{ width:`${Math.min(pctCant,100)}%`, height:'100%', background:pctCant>=100?'#22c55e':pctCant>=80?'#eab308':'#ef4444', transition:'width 0.3s' }}/>
                  </div>
                </div>
              )}
            </div>
          )}

          {esOTmodulo && modulo?.tiene_penalidad && (
            <div>
              <label className="text-xs font-semibold text-gray-400 block mb-1">Penalización manual (S/)</label>
              <input className="input-base" type="number" min="0" step="0.01" placeholder="0.00"
                value={form.val_penalidades_manual} onChange={e => setForm(p => ({ ...p, val_penalidades_manual: e.target.value }))} />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-400 block mb-1">Observaciones</label>
            <textarea className="input-base" rows={3} placeholder="Notas del proceso, incidencias, justificaciones..."
              value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
          </div>

          {estadoPreview && (
            <div className="p-3 rounded-lg border border-gray-800 text-xs" style={{ background: '#0d1526' }}>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Estado estimado</span>
                <span className="font-bold" style={{ color: estadoPreview.color }}>{estadoPreview.label}</span>
              </div>
              {pctCant !== null && (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-gray-500">Cantidad</span>
                  <span className="font-mono" style={{ color: pctCant>=100?'#22c55e':pctCant>=80?'#eab308':'#ef4444' }}>{pctCant}% entregado</span>
                </div>
              )}
            </div>
          )}

          {error && <div className="p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-xs">❌ {error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={guardar} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar seguimiento'}
          </button>
        </div>
      </div>
    </div>
  )
}
// ── Modal de descarga de documento ────────────────────────────
function ModalDescarga({ status, onClose }) {
  if (!status) return null
  const listo = status === 'word-ok' || status === 'pdf-ok'
  const error = status === 'error'
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl border p-8 flex flex-col items-center gap-4 text-center"
        style={{ background: '#0f1a2e', borderColor: error ? '#991b1b' : listo ? '#166534' : '#0e7490', minWidth: 280, maxWidth: 360 }}>
        {/* Icono */}
        {!listo && !error && (
          <div style={{ width: 48, height: 48, border: '4px solid #0e7490', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        )}
        {listo && <div style={{ fontSize: 40 }}>✅</div>}
        {error && <div style={{ fontSize: 40 }}>❌</div>}

        {/* Mensaje */}
        <div>
          {status === 'word-gen' && <><p className="text-white font-semibold text-sm mb-1">Generando documento Word</p><p className="text-gray-400 text-xs">Por favor espera un momento...</p></>}
          {status === 'pdf-gen'  && <><p className="text-white font-semibold text-sm mb-1">Generando PDF</p><p className="text-gray-400 text-xs">Esto puede tomar unos segundos si el servidor se reinició recientemente...</p></>}
          {status === 'word-ok'  && <><p className="text-green-400 font-semibold text-sm mb-1">¡Listo!</p><p className="text-gray-400 text-xs">La orden de trabajo se descargó correctamente en Word.</p></>}
          {status === 'pdf-ok'   && <><p className="text-green-400 font-semibold text-sm mb-1">¡Listo!</p><p className="text-gray-400 text-xs">El PDF se descargó correctamente.</p></>}
          {status === 'error'    && <><p className="text-red-400 font-semibold text-sm mb-1">Error al generar</p><p className="text-gray-400 text-xs">No se pudo generar el documento. Intenta de nuevo.</p></>}
        </div>

        {/* Botón cerrar — solo cuando terminó */}
        {(listo || error) && (
          <button onClick={onClose} className="mt-2 px-6 py-2 rounded-lg text-xs font-semibold"
            style={{ background: listo ? '#06b6d4' : '#ef4444', color: '#000' }}>
            {listo ? 'Cerrar' : 'Cerrar'}
          </button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>,
    document.body
  )
}
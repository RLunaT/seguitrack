'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── PIN helpers (hash simple, no requiere backend) ────────────
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('seguitrack_' + pin))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const BOTS_CALLMEBOT = [
  { numero: '+34644663262', label: '+34 644 66 32 62 (Bot 1)' },
  { numero: '+34623801190', label: '+34 623 80 11 90 (Bot 2)' },
]

const FORM_DEFAULT = {
  nombre: '', whatsapp: '', callmebot_key: '', pin: '', pin2: '',
  dias_critico: 3, activo: true, bot_number: '+34644663262'
}

const TIPOS_INFO = {
  alerta:      { label: '⚠️ Alerta',           color: '#eab308', bg: '#2c1f00' },
  critico:     { label: '⚠️ Alerta',           color: '#eab308', bg: '#2c1f00' },
  vencimiento: { label: '🔴 Vence hoy',         color: '#f97316', bg: '#2c1a07' },
  fuera:       { label: '🚨 Fuera de plazo',    color: '#ef4444', bg: '#1c0101' },
}

export default function NotificacionesPage() {
  const [configs, setConfigs]       = useState([])
  const [logs, setLogs]             = useState([])
  const [modalOpen, setModalOpen]   = useState(false)  // 'nuevo' | 'editar' | null
  const [editando, setEditando]     = useState(null)
  const [form, setForm]             = useState(FORM_DEFAULT)
  const [saving, setSaving]         = useState(false)
  const [probarMsg, setProbarMsg]   = useState('')
  const [probando, setProbando]     = useState(null)
  const [logPage, setLogPage]       = useState(0)
  const [pinModal, setPinModal]     = useState(null)   // { cfg, accion: 'editar'|'probar'|'eliminar'|'toggle' }
  const [pinInput, setPinInput]     = useState('')
  const [pinError, setPinError]     = useState('')
  const [pinVerifying, setPinVerifying] = useState(false)
  const [formError, setFormError]   = useState('')
  const LOG_SIZE = 10

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const [{ data: c }, { data: l }] = await Promise.all([
      supabase.from('notif_config').select('id, nombre, whatsapp, dias_critico, activo, pin_hash').order('id'),
      supabase.from('notif_log').select('*').order('enviado_en', { ascending: false }).limit(200),
    ])
    setConfigs(c || [])
    setLogs(l || [])
  }

  // ── Abrir modal NUEVO ─────────────────────────────────────────
  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_DEFAULT)
    setFormError('')
    setModalOpen('nuevo')
  }

  // ── Pedir PIN antes de acción sensible ────────────────────────
  function pedirPin(cfg, accion) {
    setPinModal({ cfg, accion })
    setPinInput('')
    setPinError('')
  }

  async function verificarPin() {
    if (!pinInput || pinInput.length < 4) { setPinError('Ingresa tu PIN (mínimo 4 dígitos)'); return }
    // Si no tiene pin_hash configurado, bloquear siempre
    if (!pinModal.cfg.pin_hash) {
      setPinError('Esta configuración no tiene PIN. Contacta al administrador.')
      return
    }
    setPinVerifying(true)
    const hash = await hashPin(pinInput)
    if (hash !== pinModal.cfg.pin_hash) {
      setPinError('PIN incorrecto. Inténtalo de nuevo.')
      setPinVerifying(false)
      return
    }
    // PIN correcto → ejecutar acción
    const { cfg, accion } = pinModal
    setPinModal(null); setPinInput(''); setPinError('')
    setPinVerifying(false)

    if (accion === 'editar') {
      // Cargar datos completos (incluyendo key) para editar
      const { data } = await supabase.from('notif_config').select('*').eq('id', cfg.id).single()
      setEditando(data)
      setForm({
        nombre:        data.nombre || '',
        whatsapp:      data.whatsapp || '',
        callmebot_key: data.callmebot_key || '',
        pin:           '', pin2: '',
        dias_critico:  data.dias_critico || 3,
        activo:        data.activo ?? true,
        bot_number:    data.bot_number || '+34644663262',
      })
      setFormError('')
      setModalOpen('editar')
    } else if (accion === 'probar') {
      const { data } = await supabase.from('notif_config').select('*').eq('id', cfg.id).single()
      await ejecutarPrueba(data)
    } else if (accion === 'eliminar') {
      await supabase.from('notif_config').delete().eq('id', cfg.id)
      cargar()
    } else if (accion === 'toggle') {
      await supabase.from('notif_config').update({ activo: !cfg.activo }).eq('id', cfg.id)
      cargar()
    }
  }

  // ── Guardar nuevo o editar ────────────────────────────────────
  async function guardar() {
    setFormError('')
    if (!form.whatsapp) { setFormError('El número de WhatsApp es obligatorio.'); return }
    if (!form.callmebot_key) { setFormError('La CallMeBot Key es obligatoria.'); return }

    // PIN: obligatorio al crear, opcional al editar (solo si quiere cambiarlo)
    let pin_hash = editando?.pin_hash  // mantener el hash anterior si no cambia
    if (form.pin) {
      if (form.pin.length < 4) { setFormError('El PIN debe tener al menos 4 dígitos.'); return }
      if (form.pin !== form.pin2) { setFormError('Los PINs no coinciden.'); return }
      pin_hash = await hashPin(form.pin)
    } else if (!editando) {
      setFormError('Debes crear un PIN para proteger tu configuración.')
      return
    }

    setSaving(true)
    const payload = {
      nombre:        form.nombre || null,
      whatsapp:      form.whatsapp.trim(),
      callmebot_key: form.callmebot_key.trim(),
      bot_number:    form.bot_number || '+34644663262',
      pin_hash,
      dias_critico:  Math.min(3, Math.max(1, parseInt(form.dias_critico) || 3)),
      notif_whatsapp: true,
      activo:        form.activo,
    }

    if (editando) await supabase.from('notif_config').update(payload).eq('id', editando.id)
    else await supabase.from('notif_config').insert(payload)

    setSaving(false)
    setModalOpen(null)
    cargar()
  }

  // ── Prueba de envío ───────────────────────────────────────────
  async function ejecutarPrueba(cfg) {
    setProbando(cfg.id); setProbarMsg('')
    try {
      const msg = `🧪 *SeguiTrack - Prueba*\n\nHola ${cfg.nombre || 'usuario'}, las notificaciones están funcionando correctamente ✅`
      const bot = cfg.bot_number || '+34644663262'
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cfg.whatsapp)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(cfg.callmebot_key)}&bot=${encodeURIComponent(bot)}`
      const res  = await fetch(url)
      const body = await res.text()
      setProbarMsg(res.ok && !body.toLowerCase().includes('error')
        ? '✅ Mensaje enviado correctamente.'
        : `❌ Error: ${body.slice(0, 100)}`)
    } catch(e) {
      setProbarMsg(`❌ Error de conexión: ${e.message}`)
    }
    setProbando(null)
  }

  // ── Logs resumidos ────────────────────────────────────────────
  const resumen = logs.reduce((acc, l) => {
    const dia = new Date(l.enviado_en).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'2-digit' })
    const key = `${dia}__${l.tipo}__${l.exitoso}`
    if (!acc[key]) acc[key] = { dia, tipo: l.tipo, exitoso: l.exitoso, count: 0, dests: new Set() }
    acc[key].count++
    if (l.destinatario) acc[key].dests.add(l.destinatario)
    return acc
  }, {})
  const logsPag   = Object.values(resumen).slice(logPage * LOG_SIZE, (logPage + 1) * LOG_SIZE)
  const totalPags = Math.ceil(Object.values(resumen).length / LOG_SIZE)

  const enviados = logs.filter(l => l.exitoso).length
  const errores  = logs.filter(l => !l.exitoso).length
  const hoy      = new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'2-digit' })
  const hoyEnv   = logs.filter(l => l.exitoso && new Date(l.enviado_en).toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'2-digit' }) === hoy).length

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">🔔 Notificaciones WhatsApp</h1>
        <p className="text-gray-500 text-sm mt-0.5">Cada persona gestiona su propia configuración con un PIN personal</p>
      </div>

      {/* Stats */}
      {logs.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Enviados hoy',   value: hoyEnv,   color: '#22c55e', icon: '📤' },
            { label: 'Total enviados', value: enviados,  color: '#3b82f6', icon: '✅' },
            { label: 'Con error',      value: errores,   color: errores > 0 ? '#ef4444' : '#6b7280', icon: '❌' },
          ].map((s, i) => (
            <div key={i} className="card py-3 px-4 flex items-center gap-3" style={{ borderTop: `2px solid ${s.color}` }}>
              <span className="text-xl">{s.icon}</span>
              <div>
                <div className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs text-gray-600">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Destinatarios */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">👥 Destinatarios</h2>
            <p className="text-xs text-gray-600 mt-0.5">Cada persona usa su PIN para editar su propia configuración</p>
          </div>
          <button className="btn-primary text-xs" onClick={abrirNuevo}>+ Agregar</button>
        </div>

        {configs.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            <div className="text-3xl mb-2">📱</div>
            Sin destinatarios. Agrega el primero.
          </div>
        ) : (
          <div className="space-y-2">
            {configs.map(c => (
              <div key={c.id} className={`p-3 rounded-xl border transition-all ${c.activo ? 'border-gray-800 bg-gray-900' : 'border-gray-900 bg-gray-950 opacity-50'}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-200">{c.nombre || 'Sin nombre'}</span>
                      {!c.activo && <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">Pausado</span>}
                      <span className="text-xs text-green-400 bg-green-950 px-1.5 py-0.5 rounded border border-green-900">🔒 Protegido con PIN</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs flex-wrap text-gray-500">
                      <span className="font-mono text-gray-400">💬 {c.whatsapp}</span>
                      <span>Alerta: <strong className="text-gray-400">{c.dias_critico}d</strong> antes del vencimiento</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => pedirPin(c, 'probar')} disabled={probando === c.id} title="Enviar mensaje de prueba">
                      {probando === c.id ? '⏳' : '🧪'}
                    </button>
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => pedirPin(c, 'editar')} title="Editar (requiere PIN)">✏️</button>
                    <button className="btn-ghost text-xs py-1 px-2" onClick={() => pedirPin(c, 'toggle')} title={c.activo ? 'Pausar' : 'Activar'}>
                      {c.activo ? '⏸️' : '▶️'}
                    </button>
                    <button className="btn-danger text-xs py-1 px-2" onClick={() => pedirPin(c, 'eliminar')} title="Eliminar (requiere PIN)">🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {probarMsg && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs border flex items-start justify-between gap-2 ${probarMsg.startsWith('✅') ? 'border-green-800 bg-green-950 text-green-300' : 'border-red-800 bg-red-950 text-red-300'}`}>
            <span>{probarMsg}</span>
            <button className="text-gray-600 hover:text-white flex-shrink-0" onClick={() => setProbarMsg('')}>✕</button>
          </div>
        )}
      </div>

      {/* Cómo obtener key */}
      <details className="card cursor-pointer">
        <summary className="text-xs font-semibold text-gray-400 select-none">💬 ¿Cómo obtener la CallMeBot Key? (clic para ver)</summary>
        <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-gray-400">
          <div className="space-y-2">
            <div><span className="text-green-400 font-bold">1.</span> Desde tu WhatsApp, envía este mensaje al <span className="text-green-300 font-mono">+34 644 66 32 62</span>:</div>
            <div className="bg-gray-900 rounded p-2 font-mono text-gray-200 border border-gray-700 select-all">I allow callmebot to send me messages</div>
            <div><span className="text-green-400 font-bold">2.</span> Recibes tu key personal en segundos.</div>
            <div><span className="text-green-400 font-bold">3.</span> Úsala al agregar tu configuración aquí.</div>
          </div>
          <div className="space-y-2">
            <div className="text-gray-500 font-semibold">Ejemplo de respuesta:</div>
            <div className="bg-gray-900 rounded p-2 font-mono text-green-300 border border-gray-700">
              CallMeBot API Activated for 51999999999<br/>Your apikey is: <strong>1234567</strong>
            </div>
            <div className="text-gray-600">✅ Gratis · ⚠️ Cada número tiene su propia key</div>
          </div>
        </div>
      </details>

      {/* Historial resumido */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">📋 Historial</h2>
            <p className="text-xs text-gray-600 mt-0.5">Resumen por día y tipo</p>
          </div>
          <button onClick={cargar} className="btn-ghost text-xs">🔄</button>
        </div>
        {logsPag.length === 0 ? (
          <div className="text-center py-6 text-gray-600 text-sm">Sin notificaciones enviadas aún</div>
        ) : (
          <>
            <div className="space-y-1.5">
              {logsPag.map((l, i) => {
                const ti = TIPOS_INFO[l.tipo]
                return (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-800" style={{ background: '#0d1526' }}>
                    <div className="text-xs font-mono text-gray-500 flex-shrink-0 w-16">{l.dia}</div>
                    <div className="flex-1 min-w-0">
                      {ti
                        ? <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: ti.bg, color: ti.color, border: `1px solid ${ti.color}30` }}>{ti.label}</span>
                        : <span className="text-xs text-gray-600">{l.tipo}</span>}
                    </div>
                    <div className="text-xs text-gray-500 flex-shrink-0">
                      {l.count} mensaje{l.count !== 1 ? 's' : ''} · {l.dests.size} destinatario{l.dests.size !== 1 ? 's' : ''}
                    </div>
                    <span className={`badge flex-shrink-0 ${l.exitoso ? 'badge-green' : 'badge-red'}`}>
                      {l.exitoso ? '✅ OK' : '❌ Error'}
                    </span>
                  </div>
                )
              })}
            </div>
            {totalPags > 1 && (
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-600">Página {logPage + 1} de {totalPags}</span>
                <div className="flex gap-1">
                  <button className="btn-ghost text-xs py-1 px-2" onClick={() => setLogPage(p => Math.max(0, p-1))} disabled={logPage === 0}>←</button>
                  <button className="btn-ghost text-xs py-1 px-2" onClick={() => setLogPage(p => Math.min(totalPags-1, p+1))} disabled={logPage === totalPags-1}>→</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal PIN ── */}
      {pinModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPinModal(null) }}>
          <div className="modal-box" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <div>
                <h2 className="text-base font-bold text-white">🔒 Ingresa tu PIN</h2>
                <p className="text-xs text-gray-500 mt-0.5">{pinModal.cfg.nombre || pinModal.cfg.whatsapp}</p>
              </div>
              <button onClick={() => setPinModal(null)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-400">
                {pinModal.accion === 'eliminar' ? '⚠️ Estás a punto de eliminar esta configuración.' :
                 pinModal.accion === 'editar'   ? 'Ingresa tu PIN para editar tu configuración.' :
                 pinModal.accion === 'probar'   ? 'Ingresa tu PIN para enviar un mensaje de prueba.' :
                 'Ingresa tu PIN para continuar.'}
              </p>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">PIN personal</label>
                <input
                  className="input-base text-center text-2xl font-mono tracking-widest"
                  type="password"
                  maxLength={8}
                  placeholder="••••"
                  value={pinInput}
                  onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError('') }}
                  onKeyDown={e => e.key === 'Enter' && verificarPin()}
                  autoFocus
                />
                {pinError && <p className="text-xs text-red-400 mt-1">{pinError}</p>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setPinModal(null)}>Cancelar</button>
              <button
                className={pinModal.accion === 'eliminar' ? 'btn-danger' : 'btn-primary'}
                onClick={verificarPin}
                disabled={pinVerifying || !pinInput}
              >
                {pinVerifying ? '⏳ Verificando...' : pinModal.accion === 'eliminar' ? '🗑️ Eliminar' : '✓ Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Nuevo / Editar ── */}
      {(modalOpen === 'nuevo' || modalOpen === 'editar') && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(null) }}>
          <div className="modal-box" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2 className="text-base font-bold text-white">
                {modalOpen === 'nuevo' ? '➕ Agregar mi configuración' : '✏️ Editar mi configuración'}
              </h2>
              <button onClick={() => setModalOpen(null)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Mi nombre</label>
                <input className="input-base" placeholder="Ej: Juan Pérez" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Mi WhatsApp <span className="text-red-400">*</span></label>
                <input className="input-base" placeholder="+51999999999" value={form.whatsapp} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} />
                <p className="text-xs text-gray-600 mt-1">Con código de país. Perú: +51</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  Bot de CallMeBot <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-2">
                  {BOTS_CALLMEBOT.map(b => (
                    <button key={b.numero} type="button"
                      onClick={() => setForm(p => ({ ...p, bot_number: b.numero }))}
                      className="flex-1 px-3 py-2 rounded-lg border text-xs font-mono transition-all"
                      style={form.bot_number === b.numero
                        ? { background: '#0a2a1a', borderColor: '#22c55e', color: '#22c55e' }
                        : { background: 'transparent', borderColor: '#374151', color: '#6b7280' }}>
                      {b.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Selecciona el bot al que enviaste <span className="font-mono text-green-400">I allow callmebot to send me messages</span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">
                  Mi CallMeBot Key <span className="text-red-400">*</span>
                  <span className="text-gray-600 font-normal ml-1">— solo tú la ves</span>
                </label>
                <input className="input-base font-mono" placeholder="Ej: 7260729" value={form.callmebot_key} onChange={e => setForm(p => ({ ...p, callmebot_key: e.target.value }))} />
                <p className="text-xs text-gray-600 mt-1">La recibes como respuesta del bot cuando te activas.</p>
              </div>

              {/* PIN */}
              <div className="p-3 rounded-lg border border-gray-700" style={{ background: '#0d1a2e' }}>
                <div className="text-xs font-bold text-blue-400 mb-3">🔒 {modalOpen === 'editar' ? 'Cambiar PIN (opcional)' : 'Crear tu PIN personal'}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">{modalOpen === 'editar' ? 'Nuevo PIN' : 'PIN'} <span className="text-red-400">*</span></label>
                    <input
                      className="input-base font-mono text-center tracking-widest"
                      type="password" maxLength={8} placeholder="••••"
                      value={form.pin}
                      onChange={e => setForm(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Confirmar PIN <span className="text-red-400">*</span></label>
                    <input
                      className="input-base font-mono text-center tracking-widest"
                      type="password" maxLength={8} placeholder="••••"
                      value={form.pin2}
                      onChange={e => setForm(p => ({ ...p, pin2: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  {modalOpen === 'editar'
                    ? 'Déjalo vacío para mantener el PIN actual. Mínimo 4 dígitos.'
                    : 'Solo números. Mínimo 4 dígitos. Nadie más lo verá.'}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">⚠️ Días de alerta antes del vencimiento</label>
                <input className="input-base" type="number" min="1" max="3" value={form.dias_critico} onChange={e => setForm(p => ({ ...p, dias_critico: Math.min(3, Math.max(1, parseInt(e.target.value) || 1)) }))} />
                <p className="text-xs text-gray-600 mt-1">Máximo 3 días — es el mismo umbral con el que el sistema marca una OT como "Por vencer" en toda la app. Recibirás la alerta este número de días antes de que venza.</p>
              </div>

              {/* Timeline */}
              <div className="p-3 rounded-lg bg-gray-900 border border-gray-800 text-xs space-y-3">
                <div className="font-semibold text-gray-300">¿Cuándo recibirás alertas?</div>
                <div className="relative pt-1 pb-2">
                  <div className="absolute left-0 right-0 top-4 h-0.5 bg-gray-700" />
                  <div className="relative flex justify-between items-start">
                    {[
                      { color: '#eab308', emoji: '⚠️', label: `${form.dias_critico} días antes`, sub: 'Alerta' },
                      { color: '#f97316', emoji: '🔴', label: 'Día que vence', sub: 'Aviso final' },
                      { color: '#ef4444', emoji: '🚨', label: 'Pasada la fecha', sub: 'Incumplimiento' },
                    ].map((p, i) => (
                      <div key={i} className="flex flex-col items-center gap-1" style={{ width: '30%' }}>
                        <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center z-10"
                          style={{ background: '#111827', borderColor: p.color }}>
                          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        </div>
                        <div className="text-center mt-1">
                          <div className="text-sm">{p.emoji}</div>
                          <div className="font-semibold leading-tight mt-0.5" style={{ color: p.color }}>{p.label}</div>
                          <div className="text-gray-600 leading-tight">{p.sub}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-gray-700 text-xs border-t border-gray-800 pt-2">Cada mensaje se envía una sola vez. Registros ya reportados no generan alertas.</div>
              </div>

              {formError && <div className="p-2.5 rounded-lg bg-red-950 border border-red-800 text-xs text-red-300">⚠️ {formError}</div>}

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-blue-500" checked={form.activo} onChange={e => setForm(p => ({ ...p, activo: e.target.checked }))} />
                <span className="text-sm text-gray-300">Recibir notificaciones activas</span>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModalOpen(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar} disabled={saving}>
                {saving ? '⏳...' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
/**
 * alertas-seguitrack — Supabase Edge Function
 *
 * Lógica de notificaciones inteligente (anti-spam):
 *
 *   TIPO "alerta" (N días antes del vencimiento):
 *     → Se envía UNA SOLA VEZ cuando la OT entra en la ventana de alerta.
 *       Si ya se envió "alerta" para esa OT+destinatario en este periodo,
 *       no se vuelve a enviar hasta que cambie de ventana.
 *
 *   TIPO "critico" (≤ dias_critico antes del vencimiento):
 *     → Se envía UNA SOLA VEZ cuando entra en ventana crítica.
 *
 *   TIPO "vencimiento" (día exacto del vencimiento, dias = 0):
 *     → Se envía UNA SOLA VEZ.
 *
 *   TIPO "fuera" (días_restantes < 0, es decir ya venció):
 *     → Se envía UNA SOLA VEZ por OT (no diariamente).
 *       Si el retraso crece, NO se vuelve a enviar.
 *
 *   OTs ya completadas (estado 1 o 2): NUNCA se notifican.
 *
 * El control de duplicados usa notif_log con clave (ot_id, destinatario, tipo).
 * Sólo se crea un nuevo envío si no existe un log reciente para esa combinación.
 *
 * Configurar cron en Supabase (Dashboard → Edge Functions → Schedule):
 *   "0 8 * * 1-5"  → Lunes a Viernes a las 8 AM (hora de Lima: UTC-5 → cron a las 13:00 UTC)
 *   "0 13 * * 1-5"
 *
 * Secrets necesarios en Supabase:
 *   CALLMEBOT_KEY      → clave de CallMeBot (ya configurada)
 *   SUPABASE_URL       → URL del proyecto (automático en Edge Functions)
 *   SUPABASE_SERVICE_ROLE_KEY → para acceso admin (automático)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Helpers de fecha ──────────────────────────────────────────
function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

function diasRestantes(fechaLimite: string): number {
  const lim = new Date(fechaLimite + 'T00:00:00')
  const h   = new Date(); h.setHours(0, 0, 0, 0)
  return Math.round((lim.getTime() - h.getTime()) / 86400000)
}

function fmtFecha(f: string): string {
  if (!f) return '—'
  const d = new Date(f + 'T00:00:00')
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Enviar WhatsApp via CallMeBot ─────────────────────────────
async function enviarWhatsApp(telefono: string, mensaje: string): Promise<{ ok: boolean; detalle: string }> {
  const key = Deno.env.get('CALLMEBOT_KEY')
  if (!key) return { ok: false, detalle: 'CALLMEBOT_KEY no configurado' }

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(telefono)}&text=${encodeURIComponent(mensaje)}&apikey=${key}`
  try {
    const res = await fetch(url, { method: 'GET' })
    const body = await res.text()
    if (res.ok && !body.toLowerCase().includes('error')) {
      return { ok: true, detalle: body.slice(0, 120) }
    }
    return { ok: false, detalle: body.slice(0, 120) }
  } catch (e: any) {
    return { ok: false, detalle: e?.message || 'Error de red' }
  }
}

// ── Registrar en notif_log ────────────────────────────────────
async function registrarLog(params: {
  ot_id:        number
  tipo:         string
  canal:        string
  destinatario: string
  exitoso:      boolean
  detalle:      string
  ots_count:    number
  mensaje:      string
}) {
  await supabase.from('notif_log').insert({
    ot_id:        params.ot_id,
    tipo:         params.tipo,
    canal:        params.canal,
    destinatario: params.destinatario,
    exitoso:      params.exitoso,
    detalle:      params.detalle,
    ots_count:    params.ots_count,
    mensaje:      params.mensaje,
    enviado_en:   new Date().toISOString(),
  })
}

// ── Verificar si ya se notificó ───────────────────────────────
// Devuelve true si existe un log para (ot_id, destinatario, tipo)
// en los últimos `ventanaDias` días
async function yaNotificado(
  ot_id: number,
  destinatario: string,
  tipo: string,
  ventanaDias = 60   // ventana generosa; evita duplicados en todo el ciclo
): Promise<boolean> {
  const desde = new Date()
  desde.setDate(desde.getDate() - ventanaDias)
  const { data } = await supabase
    .from('notif_log')
    .select('id')
    .eq('ot_id', ot_id)
    .eq('destinatario', destinatario)
    .eq('tipo', tipo)
    .eq('exitoso', true)
    .gte('enviado_en', desde.toISOString())
    .limit(1)
  return (data?.length ?? 0) > 0
}

// ── Determinar qué tipo de alerta corresponde ─────────────────
function clasificarAlerta(
  dias: number,
  diasAlerta: number,
  diasCritico: number
): 'alerta' | 'critico' | 'vencimiento' | 'fuera' | null {
  if (dias < 0)               return 'fuera'       // ya venció
  if (dias === 0)             return 'vencimiento'  // vence hoy
  if (dias <= diasCritico)    return 'critico'      // ventana crítica
  if (dias <= diasAlerta)     return 'alerta'       // ventana de alerta normal
  return null                                        // todavía no es urgente
}

// ── Construir mensaje WhatsApp ────────────────────────────────
function construirMensaje(
  ot: any,
  modulo: any,
  tipo: string,
  dias: number
): string {
  const emoji  = tipo === 'fuera' ? '🚨' : tipo === 'vencimiento' ? '🔴' : tipo === 'critico' ? '⚠️' : '📢'
  const tipoLabel = {
    alerta:      'ALERTA DE VENCIMIENTO',
    critico:     'ALERTA CRÍTICA',
    vencimiento: 'VENCE HOY',
    fuera:       'FUERA DE PLAZO',
  }[tipo] || 'ALERTA'

  const diasStr = dias < 0
    ? `Vencida hace ${Math.abs(dias)} día(s)`
    : dias === 0
    ? 'Vence HOY'
    : `Vence en ${dias} día(s)`

  const lineas = [
    `${emoji} *SeguiTrack - ${tipoLabel}*`,
    ``,
    `📋 *Módulo:* ${modulo?.icono || ''} ${modulo?.nombre || 'Sin módulo'}`,
    ot.numero_ot ? `🔢 *OT N°:* ${ot.numero_ot}` : null,
    ot.actividad ? `⚙️ *Actividad:* ${ot.actividad}` : null,
    `📅 *Fecha límite:* ${fmtFecha(ot.fecha_limite_expedientes)}`,
    `⏳ *Estado:* ${diasStr}`,
    ot.semana ? `📆 *Semana:* ${ot.semana}` : null,
    ``,
    `Ingresa a SeguiTrack para gestionar esta OT.`,
  ].filter(Boolean)

  return lineas.join('\n')
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────
Deno.serve(async (_req) => {
  const ahora = new Date().toISOString()
  console.log(`[alertas-seguitrack] Ejecutando: ${ahora}`)

  try {
    // 1. Cargar datos necesarios en paralelo
    const [
      { data: configs,  error: eConf },
      { data: ots,      error: eOts  },
      { data: modulos,  error: eMod  },
    ] = await Promise.all([
      supabase.from('notif_config').select('*').eq('activo', true),
      supabase.from('ots').select('*').not('fecha_limite_expedientes', 'is', null),
      supabase.from('modulos').select('id, nombre, icono'),
    ])

    if (eConf || eOts || eMod) {
      const err = eConf?.message || eOts?.message || eMod?.message
      return new Response(JSON.stringify({ error: err }), { status: 500 })
    }

    if (!configs?.length) {
      return new Response(JSON.stringify({ ok: true, msg: 'Sin destinatarios configurados' }))
    }

    const moduloMap: Record<number, any> = {}
    ;(modulos || []).forEach(m => { moduloMap[m.id] = m })

    let totalEnviados = 0
    let totalOmitidos = 0

    // 2. Por cada destinatario
    for (const cfg of (configs || [])) {
      if (!cfg.notif_whatsapp || !cfg.whatsapp) continue

      const diasAlerta  = cfg.dias_alerta  || 7
      const diasCritico = cfg.dias_critico || 3

      // 3. Por cada OT con fecha límite
      for (const ot of (ots || [])) {
        if (!ot.fecha_limite_expedientes) continue

        // Ignorar OTs ya completadas (con fecha_reporte dentro del plazo)
        if (ot.fecha_reporte) {
          const rep = new Date(ot.fecha_reporte + 'T00:00:00')
          const lim = new Date(ot.fecha_limite_expedientes + 'T00:00:00')
          if (rep <= lim) continue  // cumplió a tiempo → no notificar
          // cumplió tarde: tampoco notificar, ya cerrada
          continue
        }

        const dias  = diasRestantes(ot.fecha_limite_expedientes)
        const tipo  = clasificarAlerta(dias, diasAlerta, diasCritico)

        if (!tipo) { totalOmitidos++; continue }

        // Control de duplicados
        const duplicado = await yaNotificado(ot.id, cfg.whatsapp, tipo)
        if (duplicado) { totalOmitidos++; continue }

        // Construir y enviar
        const modulo  = moduloMap[ot.modulo_id]
        const mensaje = construirMensaje(ot, modulo, tipo, dias)
        const result  = await enviarWhatsApp(cfg.whatsapp, mensaje)

        await registrarLog({
          ot_id:        ot.id,
          tipo,
          canal:        'whatsapp',
          destinatario: cfg.whatsapp,
          exitoso:      result.ok,
          detalle:      result.detalle,
          ots_count:    1,
          mensaje:      mensaje.slice(0, 500),
        })

        if (result.ok) totalEnviados++
        else totalOmitidos++

        // Pausa entre envíos para no sobrecargar CallMeBot (límite ~20/min)
        await new Promise(r => setTimeout(r, 3500))
      }
    }

    const resumen = { ok: true, enviados: totalEnviados, omitidos: totalOmitidos, ejecutadoEn: ahora }
    console.log('[alertas-seguitrack] Resumen:', resumen)
    return new Response(JSON.stringify(resumen), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('[alertas-seguitrack] Error:', err)
    return new Response(JSON.stringify({ error: err?.message || 'Error interno' }), { status: 500 })
  }
})
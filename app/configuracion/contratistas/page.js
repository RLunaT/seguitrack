'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function ContratistasPage() {
  const [contratistas, setContratistas] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ nombre: '', contrato: '', tasa_penalidad: '', color: '#4f8ef7' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    const { data } = await supabase.from('contratistas').select('*').order('nombre')
    setContratistas(data || [])
  }

  function abrir(c = null) {
    setEditando(c)
    setForm(c ? {
      nombre: c.nombre, contrato: c.contrato || '',
      tasa_penalidad: c.tasa_penalidad || '', color: c.color || '#4f8ef7'
    } : { nombre: '', contrato: '', tasa_penalidad: '', color: '#4f8ef7' })
    setModalOpen(true)
  }

  async function guardar() {
    if (!form.nombre) return
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      contrato: form.contrato.trim() || null,
      tasa_penalidad: parseFloat(form.tasa_penalidad) || 0,
      color: form.color,
    }
    if (editando) await supabase.from('contratistas').update(payload).eq('id', editando.id)
    else await supabase.from('contratistas').insert(payload)
    setSaving(false)
    setModalOpen(false)
    cargar()
  }

  async function eliminar(id, nombre) {
    if (!confirm(`¿Eliminar "${nombre}"? Las OTs asociadas quedarán sin contratista.`)) return
    await supabase.from('contratistas').update({ activo: false }).eq('id', id)
    cargar()
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">🏢 Contratistas</h1>
          <p className="text-gray-400 text-sm mt-1">Empresas, contratos y tasas de penalidad</p>
        </div>
        <button className="btn-primary" onClick={() => abrir()}>+ Nuevo Contratista</button>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="tabla-base">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Contrato</th>
                <th>Tasa Penalidad</th>
                <th>Color</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contratistas.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-600">Sin contratistas registrados</td></tr>
              ) : contratistas.map(c => (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color || '#666' }} />
                      <span className="font-medium text-gray-200">{c.nombre}</span>
                    </div>
                  </td>
                  <td className="text-gray-400 text-xs">{c.contrato || '—'}</td>
                  <td>
                    <span className="font-mono text-xs" style={{ color: c.tasa_penalidad > 0 ? '#ef4444' : '#6b7280' }}>
                      {c.tasa_penalidad > 0 ? `S/ ${c.tasa_penalidad}/día` : '—'}
                    </span>
                  </td>
                  <td>
                    <div className="w-6 h-6 rounded" style={{ background: c.color || '#666' }} />
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn-ghost text-xs py-1 px-2" onClick={() => abrir(c)}>✏️</button>
                      <button className="btn-danger text-xs py-1 px-2" onClick={() => eliminar(c.id, c.nombre)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 className="text-base font-bold text-white">{editando ? 'Editar Contratista' : 'Nuevo Contratista'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Nombre de la empresa *</label>
                <input className="input-base" placeholder="Ej: TDEM SRL, Consorcio Energal..." value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">N° Contrato (opcional)</label>
                <input className="input-base" placeholder="Ej: Contrato 04-2024-ELPU/GG" value={form.contrato} onChange={e => setForm(p => ({ ...p, contrato: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Tasa de penalidad (S/ por día fuera de plazo)</label>
                <input className="input-base" type="number" min="0" step="0.01" placeholder="Ej: 70 o 107" value={form.tasa_penalidad} onChange={e => setForm(p => ({ ...p, tasa_penalidad: e.target.value }))} />
                <p className="text-xs text-gray-600 mt-1">En tu Excel: TDEM SRL = S/70/día · Otros = S/107/día</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 block mb-1">Color identificador</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} className="h-10 w-20 rounded border border-gray-700 bg-gray-800 cursor-pointer" />
                  <span className="text-xs text-gray-400">{form.color}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar} disabled={saving || !form.nombre}>
                {saving ? '⏳...' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
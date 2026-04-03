'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Customer {
  id: string; name: string; email: string; phone: string
  eventName: string; eventDate: string; accessCode: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; createdAt: string
}

interface FormErrors {
  name?: string; email?: string; phone?: string
  eventName?: string; eventDate?: string; maxSelectCount?: string
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', eventName: '', eventDate: '', maxSelectCount: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [search, setSearch] = useState('')

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/customers')
    const d = await r.json()
    setCustomers(Array.isArray(d) ? d : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Validate a single field
  function validateField(key: string, value: string): string {
    switch (key) {
      case 'name':
        if (!value.trim()) return 'Full name is required'
        if (value.trim().length < 2) return 'Name must be at least 2 characters'
        return ''
      case 'email':
        if (!value.trim()) return 'Email address is required'
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address'
        return ''
      case 'phone':
        if (!value.trim()) return 'Phone number is required'
        if (!/^[\d\s\+\-\(\)]{7,15}$/.test(value.replace(/\s/g, ''))) return 'Enter a valid phone number'
        return ''
      case 'eventName':
        if (!value.trim()) return 'Event name is required'
        return ''
      case 'eventDate':
        if (!value) return 'Event date is required'
        return ''
      case 'maxSelectCount':
        if (value && (isNaN(Number(value)) || Number(value) < 0)) return 'Must be a positive number or 0'
        return ''
      default:
        return ''
    }
  }

  function validateAll(): boolean {
    const fields = ['name', 'email', 'phone', 'eventName', 'eventDate']
    const newErrors: FormErrors = {}
    let valid = true
    fields.forEach(key => {
      const err = validateField(key, (form as any)[key])
      if (err) { (newErrors as any)[key] = err; valid = false }
    })
    if (form.maxSelectCount) {
      const err = validateField('maxSelectCount', form.maxSelectCount)
      if (err) { newErrors.maxSelectCount = err; valid = false }
    }
    setErrors(newErrors)
    // Mark all as touched
    const allTouched: Record<string, boolean> = {}
    fields.forEach(k => allTouched[k] = true)
    setTouched(allTouched)
    return valid
  }

  function handleChange(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    if (touched[key]) {
      const err = validateField(key, value)
      setErrors(prev => ({ ...prev, [key]: err || undefined }))
    }
  }

  function handleBlur(key: string) {
    setTouched(prev => ({ ...prev, [key]: true }))
    const err = validateField(key, (form as any)[key])
    setErrors(prev => ({ ...prev, [key]: err || undefined }))
  }

  function openModal() {
    setForm({ name: '', email: '', phone: '', eventName: '', eventDate: '', maxSelectCount: '' })
    setErrors({})
    setTouched({})
    setShowModal(true)
  }

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!validateAll()) return
    setSaving(true)
    try {
      const r = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to create client', 'error'); return }
      setShowModal(false)
      showToast(`Client created! Access code: ${d.accessCode}`)
      load()
    } finally { setSaving(false) }
  }

  async function deleteCustomer(id: string, name: string) {
    if (!confirm(`Delete client "${name}" and all their photos?`)) return
    await fetch(`/api/admin/customers/${id}`, { method: 'DELETE' })
    showToast('Client deleted')
    load()
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.eventName.toLowerCase().includes(search.toLowerCase())
  )

  function getStatus(c: Customer) {
    if (c.selectionLocked) return 'locked'
    if (c.selectedCount > 0) return 'completed'
    if (c.photoCount > 0) return 'pending'
    return 'new'
  }

  const statusStyles: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
    locked:    { label: 'Submitted',  bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa', border: 'rgba(96,165,250,0.25)',  dot: '#60a5fa' },
    completed: { label: 'In Progress',bg: 'rgba(212,160,23,0.12)',  color: '#f0d78c', border: 'rgba(212,160,23,0.25)',  dot: '#d4a017' },
    pending:   { label: 'Pending',    bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.25)',  dot: '#fbbf24' },
    new:       { label: 'New',        bg: 'rgba(148,163,184,0.10)', color: '#94a3b8', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' },
  }

  // Field config
  const fields = [
    { key: 'name',           label: 'Full Name',            placeholder: 'Ramesh & Priya',       type: 'text',   required: true,  full: true },
    { key: 'email',          label: 'Email Address',        placeholder: 'ramesh@example.com',   type: 'email',  required: true,  full: false },
    { key: 'phone',          label: 'Phone Number',         placeholder: '+91 98765 43210',      type: 'tel',    required: true,  full: false },
    { key: 'eventName',      label: 'Event Name',           placeholder: 'Wedding Reception',    type: 'text',   required: true,  full: false },
    { key: 'eventDate',      label: 'Event Date',           placeholder: '',                     type: 'date',   required: true,  full: false },
    { key: 'maxSelectCount', label: 'Max Photo Selection',  placeholder: '0 = unlimited',        type: 'number', required: false, full: false },
  ]

  return (
    <div style={{ padding: '40px 48px' }}>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, color: '#f5f0e8', marginBottom: 8 }}>Clients</h1>
          <p style={{ color: '#8a8070', fontSize: 14 }}>Manage your photography clients and photo access</p>
        </div>
        <button className="btn-gold" onClick={openModal} style={{ padding: '12px 24px', borderRadius: 10, fontSize: 14 }}>
          + New Client
        </button>
      </div>

      <div style={{ marginBottom: 22 }}>
        <input className="input-dark" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or event…" style={{ padding: '11px 16px', fontSize: 14, maxWidth: 360 }} />
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#555' }}>
            {search ? 'No clients match your search' : 'No clients yet — add your first one!'}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th><th>Event</th><th>Access Code</th>
                <th>Photos</th><th>Selected</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const st = statusStyles[getStatus(c)]
                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#f5f0e8' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#555' }}>{c.email}</div>
                    </td>
                    <td style={{ color: '#8a8070' }}>
                      <div>{c.eventName}</div>
                      {c.eventDate && <div style={{ fontSize: 11, color: '#444' }}>{c.eventDate}</div>}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f0d78c', background: 'rgba(212,160,23,0.1)', padding: '3px 8px', borderRadius: 6 }}>
                        {c.accessCode}
                      </span>
                    </td>
                    <td><span className="badge badge-gold">{c.photoCount}</span></td>
                    <td>
                      <span style={{ color: '#4ade80', fontWeight: 600 }}>{c.selectedCount}</span>
                      {c.maxSelectCount > 0 && <span style={{ color: '#555' }}> / {c.maxSelectCount}</span>}
                    </td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 20, padding: '4px 10px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Link href={`/admin/customers/${c.id}`}>
                          <button className="btn-gold" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12 }}>Manage</button>
                        </Link>
                        <button onClick={() => deleteCustomer(c.id, c.name)} className="btn-outline"
                          style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, width: '100%', maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#f5f0e8' }}>New Client</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            <form onSubmit={createCustomer} noValidate>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {fields.map(field => (
                  <div key={field.key} style={{ gridColumn: field.full ? 'span 2' : 'span 1' }}>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: (errors as any)[field.key] && touched[field.key] ? '#f87171' : '#8a8070' }}>
                      {field.label} {field.required && <span style={{ color: '#d4a017' }}>*</span>}
                    </label>
                    <input
                      className="input-dark"
                      type={field.type}
                      value={(form as any)[field.key]}
                      onChange={e => handleChange(field.key, e.target.value)}
                      onBlur={() => handleBlur(field.key)}
                      placeholder={field.placeholder}
                      min={field.key === 'maxSelectCount' ? '0' : undefined}
                      style={{
                        padding: '11px 13px', fontSize: 13,
                        borderColor: (errors as any)[field.key] && touched[field.key] ? 'rgba(248,113,113,0.5)' : undefined,
                        boxShadow: (errors as any)[field.key] && touched[field.key] ? '0 0 0 3px rgba(248,113,113,0.1)' : undefined,
                      }}
                    />
                    {(errors as any)[field.key] && touched[field.key] && (
                      <p style={{ color: '#f87171', fontSize: 11, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>⚠</span> {(errors as any)[field.key]}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 11, color: '#444', marginTop: 12, marginBottom: 20 }}>
                💡 Max Photo Selection — limits how many photos the customer can select. Leave 0 for unlimited.
              </p>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowModal(false)} className="btn-outline"
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={saving}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                  {saving ? 'Creating…' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

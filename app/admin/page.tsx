'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Customer {
  id: string
  name: string
  email: string
  phone: string
  eventName: string
  eventDate: string
  photoCount: number
  selectedCount: number
  maxSelectCount: number
  createdAt: string
  accessCode: string
}

export default function AdminDashboard() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/customers')
      .then(r => r.json())
      .then(d => { setCustomers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const totalPhotos = customers.reduce((s, c) => s + c.photoCount, 0)
  const completedCount = customers.filter(c => c.selectedCount > 0).length
  const pendingCount = customers.filter(c => c.selectedCount === 0).length

  function getStatus(c: Customer) {
    if (c.selectedCount > 0) return 'completed'
    if (c.photoCount > 0) return 'pending'
    return 'new'
  }

  const statusConfig = {
    completed: { label: 'Completed', bg: 'rgba(74,222,128,0.12)', color: '#4ade80', border: 'rgba(74,222,128,0.25)', dot: '#4ade80' },
    pending:   { label: 'Pending',   bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.25)',  dot: '#fbbf24' },
    new:       { label: 'New',       bg: 'rgba(148,163,184,0.10)', color: '#94a3b8', border: 'rgba(148,163,184,0.2)', dot: '#94a3b8' },
  }

  return (
    <div style={{ padding: '40px 48px', maxWidth: 1300 }}>
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, color: '#f5f0e8', marginBottom: 6 }}>Dashboard</h1>
        <p style={{ color: '#8a8070', fontSize: 14 }}>Welcome back — manage your clients and photo deliveries</p>
      </div>

      {/* Stats — only 2 cards now */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginBottom: 44 }}>
        {[
          { label: 'Total Clients', value: customers.length, icon: '👥', color: '#60a5fa', sub: `${completedCount} completed · ${pendingCount} pending` },
          { label: 'Total Photos', value: totalPhotos, icon: '🖼', color: '#d4a017', sub: 'Across all client folders' },
          { label: 'Completed', value: completedCount, icon: '✅', color: '#4ade80', sub: `${pendingCount} still pending selection` },
        ].map(stat => (
          <div key={stat.label} className="stat-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: '#8a8070', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{stat.label}</p>
              <span style={{ fontSize: 24 }}>{stat.icon}</span>
            </div>
            <p style={{ fontSize: 40, fontWeight: 700, color: stat.color, fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{stat.value}</p>
            <p style={{ fontSize: 11, color: '#555', marginTop: 8 }}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Client cards section */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f5f0e8' }}>All Clients</h2>
        <Link href="/admin/customers">
          <button className="btn-outline" style={{ padding: '8px 18px', borderRadius: 9, fontSize: 13 }}>+ Add Client</button>
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" />
        </div>
      ) : customers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📷</div>
          <p style={{ color: '#555', fontSize: 16, marginBottom: 20 }}>No clients yet</p>
          <Link href="/admin/customers">
            <button className="btn-gold" style={{ padding: '12px 28px', borderRadius: 10, fontSize: 14 }}>Add First Client</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {customers.map(c => {
            const status = getStatus(c)
            const sc = statusConfig[status]
            const progressPct = c.maxSelectCount > 0 ? Math.min(100, Math.round((c.selectedCount / c.maxSelectCount) * 100)) : null

            return (
              <div key={c.id} style={{
                background: '#0f0f0f',
                border: '1px solid #1e1e1e',
                borderRadius: 14,
                padding: 22,
                transition: 'all 0.25s ease',
                cursor: 'default',
                position: 'relative',
                overflow: 'hidden',
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(212,160,23,0.3)'
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#1e1e1e'
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                }}
              >
                {/* Top row: name + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f5f0e8', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </h3>
                    <p style={{ fontSize: 12, color: '#8a8070', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.eventName}</p>
                  </div>
                  {/* Status badge */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: sc.bg, border: `1px solid ${sc.border}`,
                    borderRadius: 20, padding: '4px 10px', flexShrink: 0,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc.dot, boxShadow: `0 0 6px ${sc.dot}` }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: sc.color, letterSpacing: '0.05em' }}>{sc.label}</span>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: '#1a1a1a', marginBottom: 14 }} />

                {/* Info grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Photos</p>
                    <p style={{ fontSize: 20, fontWeight: 700, color: '#d4a017', fontFamily: "'Playfair Display', serif" }}>{c.photoCount}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Selected</p>
                    <p style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', fontFamily: "'Playfair Display', serif" }}>
                      {c.selectedCount}
                      {c.maxSelectCount > 0 && <span style={{ fontSize: 12, color: '#555', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>/{c.maxSelectCount}</span>}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Event Date</p>
                    <p style={{ fontSize: 13, color: '#8a8070' }}>{c.eventDate || '—'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Added</p>
                    <p style={{ fontSize: 13, color: '#8a8070' }}>
                      {new Date(c.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                </div>

                {/* Selection progress bar (if maxSelectCount set) */}
                {progressPct !== null && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Selection Progress</span>
                      <span style={{ fontSize: 10, color: '#8a8070' }}>{progressPct}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                )}

                {/* Access code */}
                <div style={{ background: 'rgba(212,160,23,0.06)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Access Code</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#f0d78c', fontWeight: 700 }}>{c.accessCode}</span>
                </div>

                {/* Actions */}
                <Link href={`/admin/customers/${c.id}`} style={{ display: 'block' }}>
                  <button className="btn-gold" style={{ width: '100%', padding: '10px 0', borderRadius: 9, fontSize: 13 }}>
                    Manage Client →
                  </button>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

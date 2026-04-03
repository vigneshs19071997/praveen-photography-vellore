'use client'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  const navItems = [
    { href: '/admin', label: 'Dashboard', icon: '◈' },
    { href: '/admin/customers', label: 'Customers', icon: '👥' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0a0a' }}>
      <aside style={{
        width: 240, background: '#0d0d0d', borderRight: '1px solid #1a1a1a',
        display: 'flex', flexDirection: 'column', padding: '24px 16px', flexShrink: 0,
      }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #d4a017, #b8860b)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>📷</div>
            <div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: '#f0d78c', fontWeight: 600 }}>Praveen</div>
              <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Photography</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 8, marginBottom: 8 }}>Navigation</div>
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`nav-item ${pathname === item.href ? 'active' : ''}`}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 16 }}>
          <div style={{ paddingLeft: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#8a8070' }}>Signed in as</div>
            <div style={{ fontSize: 13, color: '#f0d78c', fontWeight: 600 }}>Admin</div>
          </div>
          <button onClick={logout} className="nav-item" style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
            <span>🚪</span> Sign Out
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}

'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Photo {
  id: string; filename: string; originalName: string
  thumbnailUrl: string; mimeType: string; size: number
  isSelected: boolean; localPath: string; uploadedAt: string
  folderDbId: string; folderName: string
}
interface Folder { id: string; name: string; description: string; photoCount: number }
interface Customer {
  id: string; name: string; eventName: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; selectionLockedAt: string | null
}

export default function CustomerGallery() {
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [lightbox, setLightbox] = useState<{ photo: Photo; index: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activeFolder, setActiveFolder] = useState<string>('all')

  function showToast(msg: string, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  const loadGallery = useCallback(async () => {
    const r = await fetch('/api/customer/gallery')
    if (r.status === 401) { router.push('/'); return }
    const d = await r.json()
    setCustomer(d.customer)
    setFolders(d.folders || [])
    setPhotos(d.photos || [])
    const pre = new Set<string>((d.photos || []).filter((p: Photo) => p.isSelected).map((p: Photo) => p.id))
    setSelected(pre)
    setLoading(false)
  }, [router])

  useEffect(() => { loadGallery() }, [loadGallery])

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!lightbox) return
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') navLightbox(1)
      if (e.key === 'ArrowLeft') navLightbox(-1)
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(5, z + 0.25))
      if (e.key === '-') setZoom(z => Math.max(1, z - 0.25))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const filteredPhotos = activeFolder === 'all' ? photos : photos.filter(p => p.folderDbId === activeFolder)
  const maxCount = customer?.maxSelectCount || 0
  const atLimit = maxCount > 0 && selected.size >= maxCount
  const isLocked = customer?.selectionLocked === true

  function toggleSelect(photoId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(photoId)) {
        next.delete(photoId)
      } else {
        if (maxCount > 0 && next.size >= maxCount) {
          showToast(`You can only select up to ${maxCount} photos`, 'error')
          return prev
        }
        next.add(photoId)
      }
      return next
    })
  }

  function openLightbox(photo: Photo) {
    const idx = filteredPhotos.findIndex(p => p.id === photo.id)
    setLightbox({ photo, index: idx })
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
  }

  function closeLightbox() {
    setLightbox(null)
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
  }

  function navLightbox(dir: number) {
    if (!lightbox) return
    const ni = lightbox.index + dir
    if (ni < 0 || ni >= filteredPhotos.length) return
    setLightbox({ photo: filteredPhotos[ni], index: ni })
    setZoom(1); setPanOffset({ x: 0, y: 0 })
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setZoom(z => Math.max(1, Math.min(5, z + (e.deltaY < 0 ? 0.15 : -0.15))))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning) return
    setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
  }

  function handleMouseUp() { setIsPanning(false) }

  async function saveSelections() {
    setSaving(true)
    try {
      const photoIds = Array.from(selected)
      const localPaths = photoIds.map(pid => {
        const photo = photos.find(p => p.id === pid)
        return photo
          ? `Selected/${customer?.name || 'photos'}/${photo.folderName ? photo.folderName + '/' : ''}${photo.originalName}`
          : ''
      })

      // PUT = final confirm + lock
      const r = await fetch('/api/customer/select', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds, localPaths }),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to save', 'error'); return }

      await loadGallery()
      showToast(`${d.selectedCount} photos submitted successfully! Your selection is now locked.`)
      setConfirmOpen(false)
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a', flexDirection: 'column', gap: 14 }}>
      <div className="spinner" />
      <p style={{ color: '#8a8070', fontSize: 14 }}>Loading your gallery…</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a' }}>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Header */}
      <header style={{
        background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '0 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 62,
        position: 'sticky', top: 0, zIndex: 200,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #d4a017, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📷</div>
          <span style={{ fontFamily: "'Playfair Display', serif", color: '#f0d78c', fontSize: 16, fontWeight: 600 }}>Praveen Photography</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Selection counter pill */}
          <div style={{
            background: isLocked ? 'rgba(96,165,250,0.1)' : selected.size > 0 ? 'rgba(212,160,23,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isLocked ? 'rgba(96,165,250,0.3)' : selected.size > 0 ? 'rgba(212,160,23,0.3)' : '#2a2a2a'}`,
            borderRadius: 20, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.3s',
          }}>
            <span style={{ fontSize: 12 }}>{isLocked ? '🔒' : '📷'}</span>
            <span style={{ fontSize: 12, color: '#8a8070' }}>{isLocked ? 'Submitted:' : 'Selected:'}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: isLocked ? '#60a5fa' : selected.size > 0 ? '#f0d78c' : '#555' }}>
              {isLocked ? customer?.selectedCount : selected.size}
            </span>
            {maxCount > 0 && <span style={{ fontSize: 12, color: '#555' }}>/ {maxCount}</span>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: '#f5f0e8', fontWeight: 600 }}>{customer?.name}</div>
            <div style={{ fontSize: 11, color: '#555' }}>{customer?.eventName}</div>
          </div>
          <button onClick={logout} className="btn-outline" style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12 }}>Sign Out</button>
        </div>
      </header>

      {/* Locked banner — shown when customer has already submitted */}
      {isLocked && (
        <div style={{ background: 'rgba(96,165,250,0.08)', borderBottom: '1px solid rgba(96,165,250,0.2)', padding: '12px 32px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', marginBottom: 2 }}>Your photo selection has been submitted</p>
            <p style={{ fontSize: 12, color: '#555' }}>
              You selected <strong style={{ color: '#f0d78c' }}>{customer?.selectedCount} photos</strong>.
              {customer?.selectionLockedAt && ` Submitted on ${new Date(customer.selectionLockedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`}
              {' '}Contact your photographer if you need to make changes.
            </p>
          </div>
        </div>
      )}

      {/* Limit warning banner */}
      {!isLocked && atLimit && (
        <div style={{ background: 'rgba(251,191,36,0.1)', borderBottom: '1px solid rgba(251,191,36,0.2)', padding: '10px 32px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: '#fbbf24' }}>You've reached your selection limit of <strong>{maxCount} photos</strong>. Deselect a photo to choose a different one.</span>
        </div>
      )}

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 62px)' }}>
        {/* Folder sidebar */}
        {folders.length > 0 && (
          <aside style={{ width: 210, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', padding: '20px 12px', flexShrink: 0, position: 'sticky', top: 62, height: 'calc(100vh - 62px)', overflowY: 'auto' }}>
            <p style={{ fontSize: 10, color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', paddingLeft: 8, marginBottom: 10 }}>Folders</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[{ id: 'all', name: 'All Photos', photoCount: photos.length } as any, ...folders].map(folder => (
                <button key={folder.id}
                  onClick={() => setActiveFolder(folder.id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: activeFolder === folder.id ? 'rgba(212,160,23,0.12)' : 'transparent',
                    color: activeFolder === folder.id ? '#f0d78c' : '#8a8070', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {folder.id === 'all' ? '📂' : '📁'} {folder.name}
                  </span>
                  <span style={{ fontSize: 11, color: '#555', flexShrink: 0, marginLeft: 6 }}>{folder.photoCount}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        {/* Main gallery */}
        <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {/* Page title + actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: '#f5f0e8', marginBottom: 4 }}>
                {activeFolder === 'all' ? 'Your Gallery' : folders.find(f => f.id === activeFolder)?.name || 'Gallery'}
              </h1>
              <p style={{ color: '#8a8070', fontSize: 13 }}>Click the checkbox to select · Click image to view & zoom</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge badge-gold">{filteredPhotos.length} photos</span>
              {maxCount > 0 && (
                <span className="badge" style={{
                  background: atLimit ? 'rgba(251,191,36,0.15)' : 'rgba(74,222,128,0.1)',
                  color: atLimit ? '#fbbf24' : '#4ade80',
                  border: `1px solid ${atLimit ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.2)'}`,
                }}>
                  {selected.size}/{maxCount} selected
                </span>
              )}
            </div>
          </div>

          {/* Action buttons — hidden when locked */}
          {filteredPhotos.length > 0 && !isLocked && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
              <button onClick={() => {
                if (maxCount > 0) {
                  const ids = filteredPhotos.slice(0, maxCount).map(p => p.id)
                  setSelected(new Set(ids))
                  if (filteredPhotos.length > maxCount) showToast(`Limited to ${maxCount} photos max`, 'error')
                } else {
                  setSelected(new Set(photos.map(p => p.id)))
                }
              }} className="btn-outline" style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12 }}>Select All</button>
              <button onClick={() => setSelected(new Set())} className="btn-outline" style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12 }}>Clear All</button>
              {selected.size > 0 && (
                <button onClick={() => setConfirmOpen(true)} className="btn-gold" style={{ padding: '7px 20px', borderRadius: 8, fontSize: 12 }}>
                  ✓ Submit {selected.size} Photo{selected.size !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}

          {/* Locked notice in gallery area */}
          {isLocked && filteredPhotos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 18 }}>🔒</span>
              <div>
                <p style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600, marginBottom: 2 }}>Selection locked — view only</p>
                <p style={{ fontSize: 12, color: '#555' }}>Your selected photos are highlighted in gold. Contact your photographer to make changes.</p>
              </div>
            </div>
          )}

          {/* Grid */}
          {filteredPhotos.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>📸</div>
              <p style={{ color: '#555', fontSize: 15 }}>No photos here yet — check back soon!</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {filteredPhotos.map(photo => {
                const isSel = selected.has(photo.id)
                const isDisabled = !isSel && (atLimit || isLocked)
                return (
                  <div key={photo.id}
                    style={{
                      position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '1',
                      background: '#111',
                      outline: isSel ? '3px solid #d4a017' : '3px solid transparent',
                      outlineOffset: '-3px',
                      transition: 'transform 0.15s, outline 0.15s, opacity 0.15s',
                      transform: isSel ? 'scale(0.97)' : 'scale(1)',
                      opacity: isLocked && !isSel ? 0.45 : isDisabled ? 0.5 : 1,
                      cursor: 'pointer',
                    }}
                    onClick={() => openLightbox(photo)}
                  >
                    <img
                      src={photo.thumbnailUrl}
                      alt={photo.originalName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none' }}
                      loading="lazy"
                      draggable={false}
                    />

                    {/* Watermark bottom-right */}
                    <div style={{
                      position: 'absolute', bottom: 6, right: 8,
                      fontFamily: "'Playfair Display', serif", fontSize: 9, fontWeight: 700,
                      color: 'rgba(255,255,255,0.5)', letterSpacing: '0.06em',
                      textShadow: '0 1px 4px rgba(0,0,0,0.95)', pointerEvents: 'none', whiteSpace: 'nowrap',
                    }}>© Praveen Photography</div>

                    {/* Checkbox — top-right corner; hidden when locked */}
                    {!isLocked ? (
                      <div
                        onClick={e => toggleSelect(photo.id, e)}
                        style={{
                          position: 'absolute', top: 7, right: 7,
                          width: 22, height: 22, borderRadius: 6,
                          background: isSel ? '#d4a017' : 'rgba(0,0,0,0.55)',
                          border: `2px solid ${isSel ? '#d4a017' : 'rgba(255,255,255,0.4)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s', zIndex: 5,
                          backdropFilter: 'blur(4px)',
                        }}
                        title={isDisabled ? `Max ${maxCount} photos allowed` : isSel ? 'Deselect' : 'Select'}>
                        {isSel && <span style={{ color: '#0a0a0a', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>}
                      </div>
                    ) : isSel ? (
                      /* Locked + selected: show gold check */
                      <div style={{
                        position: 'absolute', top: 7, right: 7,
                        width: 22, height: 22, borderRadius: 6,
                        background: '#d4a017', border: '2px solid #d4a017',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 5,
                      }}>
                        <span style={{ color: '#0a0a0a', fontSize: 13, fontWeight: 800, lineHeight: 1 }}>✓</span>
                      </div>
                    ) : null}

                    {/* Already saved ribbon */}
                    {photo.isSelected && !isSel && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'rgba(74,222,128,0.18)', padding: '3px 0', fontSize: 9, color: '#4ade80', textAlign: 'center', letterSpacing: '0.05em', fontWeight: 700 }}>SAVED</div>
                    )}

                    {/* Zoom hint overlay on hover */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'rgba(0,0,0,0)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.2s',
                    }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.25)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0)'}
                    >
                      <span style={{ color: 'rgba(255,255,255,0)', fontSize: 22, transition: 'color 0.2s', pointerEvents: 'none' }}
                        className="zoom-hint">🔍</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* Floating counter */}
      {photos.length > 0 && (
        <div className="floating-counter" style={isLocked ? { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' } : {}}>
          {isLocked ? '🔒' : '🖼'} {photos.length} · ✅ {isLocked ? customer?.selectedCount : selected.size}{maxCount > 0 ? `/${maxCount}` : ''}
          {isLocked && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>Submitted</span>}
        </div>
      )}

      {/* Confirm modal — final submission */}
      {confirmOpen && !isLocked && (
        <div className="modal-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, maxWidth: 400, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#f5f0e8', marginBottom: 10 }}>Submit Your Selection</h2>
            <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 8 }}>
              You are submitting <strong style={{ color: '#f0d78c' }}>{selected.size} photos</strong> as your final selection.
            </p>
            <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, textAlign: 'left' }}>
              <p style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>⚠️ This action will lock your selection</p>
              <p style={{ fontSize: 12, color: '#555' }}>Once submitted, you will not be able to change your selection unless your photographer resets it for you.</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} className="btn-outline" style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                Go Back
              </button>
              <button onClick={saveSelections} className="btn-gold" disabled={saving} style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontSize: 14 }}>
                {saving ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    Submitting…
                  </span>
                ) : '🔒 Submit Final Selection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox — full zoom & pan */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}
          onClick={closeLightbox}>

          {/* Top controls */}
          <div onClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
            {/* Left: name + position */}
            <div>
              <p style={{ color: '#f5f0e8', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{lightbox.photo.originalName}</p>
              <p style={{ color: '#555', fontSize: 11 }}>{lightbox.index + 1} of {filteredPhotos.length}</p>
            </div>
            {/* Center: zoom controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setZoom(z => Math.max(1, z - 0.25))}
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0d78c', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
              <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '6px 14px', minWidth: 68, textAlign: 'center' }}>
                <span style={{ color: '#f0d78c', fontSize: 13, fontWeight: 600 }}>{Math.round(zoom * 100)}%</span>
              </div>
              <button onClick={() => setZoom(z => Math.min(5, z + 0.25))}
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0d78c', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
              <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }) }}
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#8a8070', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>Reset</button>
            </div>
            {/* Right: select + close */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={e => { e.stopPropagation(); if (!isLocked) toggleSelect(lightbox.photo.id, e as any) }}
                disabled={isLocked || (!selected.has(lightbox.photo.id) && atLimit)}
                style={{
                  background: selected.has(lightbox.photo.id) ? 'rgba(212,160,23,0.2)' : '#1a1a1a',
                  border: `1px solid ${selected.has(lightbox.photo.id) ? '#d4a017' : '#2a2a2a'}`,
                  color: isLocked ? '#555' : selected.has(lightbox.photo.id) ? '#f0d78c' : '#8a8070',
                  borderRadius: 8, padding: '7px 16px', cursor: isLocked ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  opacity: (isLocked || (!selected.has(lightbox.photo.id) && atLimit)) ? 0.4 : 1,
                }}>
                {isLocked ? '🔒 Locked' : selected.has(lightbox.photo.id) ? '✓ Selected' : 'Select'}
              </button>
              <button onClick={closeLightbox}
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#8a8070', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          </div>

          {/* Image area */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
            {/* Prev arrow */}
            {lightbox.index > 0 && (
              <button onClick={e => { e.stopPropagation(); navLightbox(-1) }}
                style={{ position: 'absolute', left: 16, zIndex: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid #2a2a2a', color: '#f5f0e8', borderRadius: 12, width: 48, height: 48, cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
            )}
            {/* Next arrow */}
            {lightbox.index < filteredPhotos.length - 1 && (
              <button onClick={e => { e.stopPropagation(); navLightbox(1) }}
                style={{ position: 'absolute', right: 16, zIndex: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid #2a2a2a', color: '#f5f0e8', borderRadius: 12, width: 48, height: 48, cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            )}

            {/* Zoom + pan container */}
            <div onClick={e => e.stopPropagation()}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default', position: 'relative' }}>
              <div style={{
                transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
                transition: isPanning ? 'none' : 'transform 0.12s ease',
                transformOrigin: 'center',
              }}>
                <img
                  src={lightbox.photo.thumbnailUrl}
                  alt={lightbox.photo.originalName}
                  style={{ maxWidth: 'min(88vw, 1100px)', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain', display: 'block', borderRadius: zoom === 1 ? 10 : 0 }}
                  draggable={false}
                />
                {/* Watermark on lightbox */}
                <div style={{
                  position: 'absolute', bottom: 10, right: 14,
                  fontFamily: "'Playfair Display', serif", fontSize: 12, fontWeight: 700,
                  color: 'rgba(255,255,255,0.4)', letterSpacing: '0.07em',
                  textShadow: '0 1px 5px rgba(0,0,0,0.99)', pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>© Praveen Photography</div>
              </div>
            </div>
          </div>

          {/* Bottom hint */}
          <div onClick={e => e.stopPropagation()}
            style={{ padding: '8px 20px', background: 'rgba(0,0,0,0.5)', borderTop: '1px solid #1a1a1a', textAlign: 'center', flexShrink: 0 }}>
            <span style={{ color: '#333', fontSize: 11 }}>Scroll to zoom · Drag to pan · ← → to navigate · Esc to close</span>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Customer {
  id: string; name: string; email: string; phone: string
  eventName: string; eventDate: string; accessCode: string
  photoCount: number; selectedCount: number; maxSelectCount: number
  selectionLocked: boolean; selectionLockedAt: string | null
}
interface Folder {
  id: string; name: string; description: string
  photoCount: number; localSourcePath: string
}
interface Photo {
  id: string; originalName: string; mimeType: string; size: number
  thumbnailUrl: string; isSelected: boolean; folderDbId: string
  folderName: string; savedToFolder: boolean; uploadedAt: string
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: any) => Promise<FileSystemDirectoryHandle>
  }
}

// ─── Session-level handle store ─────────────────────────────────────────────
// Maps folderDbId → { dirHandle, fileMap }
// dirHandle: the picked directory
// fileMap: filename → FileSystemFileHandle (for reading full-res during save)
type FolderSession = {
  dirHandle: FileSystemDirectoryHandle
  fileMap: Record<string, FileSystemFileHandle>
}
const sessionStore: Record<string, FolderSession> = {}

// Maps folderDbId → filename → File (for photos uploaded directly via file input)
const uploadedFilesMap: Record<string, Record<string, File>> = {}

// ─── Client-side thumbnail generator ────────────────────────────────────────
// Reads the File object, draws it onto a canvas at max 300×300px,
// exports as JPEG quality 0.35 → ~10-30 KB
async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 300
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height / width) * MAX); width = MAX }
        else { width = Math.round((width / height) * MAX); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      // Export as JPEG at low quality — metadata preview only
      const dataUrl = canvas.toDataURL('image/jpeg', 0.35)
      resolve(dataUrl.split(',')[1]) // return base64 portion only
    }
    img.onerror = reject
    img.src = url
  })
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null)
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0, phase: '' })
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 })
  const [resetting, setResetting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [folderForm, setFolderForm] = useState({ name: '', description: '' })
  const [savingFolder, setSavingFolder] = useState(false)
  const [fsSupportError, setFsSupportError] = useState(false)
  const [linkedLabels, setLinkedLabels] = useState<Record<string, string>>({}) // folderId → dir name
  const [uploadMode, setUploadMode] = useState<'folder' | 'files'>('folder')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [cr, fr] = await Promise.all([
      fetch(`/api/admin/customers/${id}`),
      fetch(`/api/admin/folders?customerId=${id}`),
    ])
    if (cr.ok) { const d = await cr.json(); setCustomer(d.customer); setPhotos(d.photos || []) }
    if (fr.ok) {
      const list: Folder[] = await fr.json()
      setFolders(Array.isArray(list) ? list : [])
      setActiveFolder(prev => prev ? (list.find(f => f.id === prev.id) || null) : null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // ─── Create folder ────────────────────────────────────────────────────────
  async function createFolder(e: React.FormEvent) {
    e.preventDefault()
    setSavingFolder(true)
    try {
      const r = await fetch('/api/admin/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: id, ...folderForm }),
      })
      if (!r.ok) { showToast('Failed to create folder', 'error'); return }
      const newFolder: Folder = await r.json()
      showToast(`Folder "${newFolder.name}" created`)
      setShowFolderModal(false)
      setFolderForm({ name: '', description: '' })
      await load()
      setActiveFolder(newFolder)
    } finally { setSavingFolder(false) }
  }

  async function deleteFolder(folder: Folder) {
    if (!confirm(`Delete folder "${folder.name}" and all its photo records?`)) return
    await fetch(`/api/admin/folders?folderId=${folder.id}`, { method: 'DELETE' })
    delete sessionStore[folder.id]
    setLinkedLabels(p => { const n = { ...p }; delete n[folder.id]; return n })
    if (activeFolder?.id === folder.id) setActiveFolder(null)
    showToast('Folder deleted')
    load()
  }

  // ─── Pick folder → generate thumbnails in browser → send metadata to DB ──
  async function pickFolderAndProcess() {
    if (!activeFolder) { showToast('Select a folder first', 'error'); return }
    if (!window.showDirectoryPicker) { setFsSupportError(true); return }

    let dirHandle: FileSystemDirectoryHandle
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'read' })
    } catch { return }

    // Build a map of filename → FileSystemFileHandle
    const fileMap: Record<string, FileSystemFileHandle> = {}
    const imageFiles: File[] = []
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind === 'file') {
        const file: File = await (entry as FileSystemFileHandle).getFile()
        if (file.type.startsWith('image/')) {
          imageFiles.push(file)
          fileMap[file.name] = entry as FileSystemFileHandle
        }
      }
    }

    if (!imageFiles.length) { showToast('No images found in that folder', 'error'); return }

    // Store session (for later full-res copy)
    sessionStore[activeFolder.id] = { dirHandle, fileMap }
    setLinkedLabels(p => ({ ...p, [activeFolder.id]: dirHandle.name }))

    // Persist path label to DB
    await fetch('/api/admin/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: activeFolder.id, localSourcePath: dirHandle.name }),
    })

    // ── Generate thumbnails with 20 concurrent workers, then upload in parallel ──
    setProcessing(true)
    setProcessProgress({ current: 0, total: imageFiles.length, phase: 'Generating thumbnails…' })

    type PhotoPayload = { originalName: string; mimeType: string; size: number; thumbnailData: string }
    const allPayloads: PhotoPayload[] = new Array(imageFiles.length)
    let thumbIdx = 0, thumbDone = 0

    async function thumbWorker() {
      while (thumbIdx < imageFiles.length) {
        const i = thumbIdx++
        const file = imageFiles[i]
        allPayloads[i] = { originalName: file.name, mimeType: file.type, size: file.size, thumbnailData: await generateThumbnail(file) }
        setProcessProgress({ current: ++thumbDone, total: imageFiles.length, phase: 'Generating thumbnails…' })
      }
    }
    await Promise.all(Array.from({ length: 20 }, thumbWorker))

    setProcessProgress({ current: imageFiles.length, total: imageFiles.length, phase: 'Uploading to cloud…' })

    // Split into 3 parallel requests — each runs 10 concurrent Cloudinary workers = 30 total
    const CHUNKS = 3
    const chunkSize = Math.ceil(allPayloads.length / CHUNKS)
    const uploadChunks = Array.from({ length: CHUNKS }, (_, i) =>
      allPayloads.slice(i * chunkSize, (i + 1) * chunkSize)
    ).filter(c => c.length > 0)

    const results = await Promise.all(uploadChunks.map(chunk =>
      fetch('/api/admin/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: id, folderDbId: activeFolder.id, photos: chunk }),
      }).then(r => r.json())
    ))
    const registered = results.reduce((sum: number, d: any) => sum + (d.uploaded || 0), 0)

    showToast(`✅ ${registered} photos registered. Full-res files remain on your disk.`)
    setProcessing(false)
    setProcessProgress({ current: 0, total: 0, phase: '' })
    load()
  }

  // ─── Upload individual files → generate thumbnails → send metadata to DB ─
  async function uploadFilesAndProcess(files: FileList | null) {
    if (!activeFolder) { showToast('Select a folder first', 'error'); return }
    if (!files || !files.length) return

    const imageFiles: File[] = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!imageFiles.length) { showToast('No image files selected', 'error'); return }

    // Merge into sessionStore so "Save Selected" can read them later
    const existing = sessionStore[activeFolder.id]
    const fileMap: Record<string, FileSystemFileHandle> = existing?.fileMap || {}
    // For uploaded files we store File objects directly in a parallel map
    // We re-use the same session but override fileMap with File-backed stubs
    // We'll store uploaded File objects in a separate uploadedFilesMap
    if (!uploadedFilesMap[activeFolder.id]) uploadedFilesMap[activeFolder.id] = {}
    for (const file of imageFiles) {
      uploadedFilesMap[activeFolder.id][file.name] = file
    }
    // Ensure sessionStore entry exists for "Save Selected" flow
    if (!sessionStore[activeFolder.id]) {
      sessionStore[activeFolder.id] = { dirHandle: null as any, fileMap: {} }
    }

    setLinkedLabels(p => ({ ...p, [activeFolder.id]: `${imageFiles.length} file(s) uploaded` }))

    setProcessing(true)
    setProcessProgress({ current: 0, total: imageFiles.length, phase: 'Generating thumbnails…' })

    type PhotoPayload = { originalName: string; mimeType: string; size: number; thumbnailData: string }
    const allPayloads: PhotoPayload[] = new Array(imageFiles.length)
    let thumbIdx = 0, thumbDone = 0

    async function thumbWorker() {
      while (thumbIdx < imageFiles.length) {
        const i = thumbIdx++
        const file = imageFiles[i]
        allPayloads[i] = { originalName: file.name, mimeType: file.type, size: file.size, thumbnailData: await generateThumbnail(file) }
        setProcessProgress({ current: ++thumbDone, total: imageFiles.length, phase: 'Generating thumbnails…' })
      }
    }
    await Promise.all(Array.from({ length: 20 }, thumbWorker))

    setProcessProgress({ current: imageFiles.length, total: imageFiles.length, phase: 'Uploading to cloud…' })

    const CHUNKS = 3
    const chunkSize = Math.ceil(allPayloads.length / CHUNKS)
    const uploadChunks = Array.from({ length: CHUNKS }, (_, i) =>
      allPayloads.slice(i * chunkSize, (i + 1) * chunkSize)
    ).filter(c => c.length > 0)

    const results = await Promise.all(uploadChunks.map(chunk =>
      fetch('/api/admin/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: id, folderDbId: activeFolder.id, photos: chunk }),
      }).then(r => r.json())
    ))
    const registered = results.reduce((sum: number, d: any) => sum + (d.uploaded || 0), 0)

    showToast(`✅ ${registered} photos registered from uploaded files.`)
    setProcessing(false)
    setProcessProgress({ current: 0, total: 0, phase: '' })
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
    load()
  }

  // ─── Re-link folder handle (after page reload) ───────────────────────────
  async function relinkFolder(folder: Folder) {
    if (!window.showDirectoryPicker) { setFsSupportError(true); return }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      const fileMap: Record<string, FileSystemFileHandle> = {}
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === 'file') {
          const file: File = await (entry as FileSystemFileHandle).getFile()
          if (file.type.startsWith('image/')) fileMap[file.name] = entry as FileSystemFileHandle
        }
      }
      sessionStore[folder.id] = { dirHandle, fileMap }
      setLinkedLabels(p => ({ ...p, [folder.id]: dirHandle.name }))
      showToast(`🔗 Linked "${dirHandle.name}" — ready to save selected photos`)
    } catch { /* cancelled */ }
  }

  // ─── Save selected photos to local disk: read from source, write to dest ─
  async function saveSelectedToFolder() {
    if (!customer) return
    if (!window.showDirectoryPicker) { setFsSupportError(true); return }

    const r = await fetch(`/api/admin/download?customerId=${id}`)
    if (!r.ok) { showToast('No selected photos found', 'error'); return }
    const { photos: selectedMeta } = await r.json()
    if (!selectedMeta?.length) { showToast('No selected photos', 'error'); return }

    const destFolderName = `${customer.name} Selected`

    // Group by folderDbId
    type Meta = { id: string; originalName: string; mimeType: string; folderDbId: string }
    const byFolder: Record<string, Meta[]> = {}
    for (const p of selectedMeta as Meta[]) {
      const k = p.folderDbId || '__root__'
      if (!byFolder[k]) byFolder[k] = []
      byFolder[k].push(p)
    }

    setSaving(true)
    setSaveProgress({ current: 0, total: selectedMeta.length })
    let written = 0

    for (const [folderDbId, group] of Object.entries(byFolder)) {
      let session = sessionStore[folderDbId]

      if (!session) {
        const srcFolder = folders.find(f => f.id === folderDbId)
        const label = srcFolder?.localSourcePath || srcFolder?.name || 'the source folder'
        showToast(`📂 Please re-select the source folder: "${label}"`)
        try {
          const dh = await window.showDirectoryPicker!({ mode: 'readwrite', startIn: 'pictures' })
          const fm: Record<string, FileSystemFileHandle> = {}
          for await (const entry of (dh as any).values()) {
            if (entry.kind === 'file') {
              const f: File = await (entry as FileSystemFileHandle).getFile()
              if (f.type.startsWith('image/')) fm[f.name] = entry as FileSystemFileHandle
            }
          }
          session = { dirHandle: dh, fileMap: fm }
          sessionStore[folderDbId] = session
          setLinkedLabels(p => ({ ...p, [folderDbId]: dh.name }))
        } catch {
          showToast(`Skipped ${group.length} photos — folder not selected`, 'error')
          written += group.length
          setSaveProgress({ current: written, total: selectedMeta.length })
          continue
        }
      }

      // Request write access to the directory (only if we have a real dirHandle)
      let destDir: FileSystemDirectoryHandle
      if (session.dirHandle) {
        try {
          const perm = await (session.dirHandle as any).requestPermission({ mode: 'readwrite' })
          if (perm !== 'granted') throw new Error('denied')
        } catch {
          // Re-pick
          try {
            const dh = await window.showDirectoryPicker!({ mode: 'readwrite', startIn: 'pictures' })
            const fm: Record<string, FileSystemFileHandle> = {}
            for await (const entry of (dh as any).values()) {
              if (entry.kind === 'file') {
                const f: File = await (entry as FileSystemFileHandle).getFile()
                if (f.type.startsWith('image/')) fm[f.name] = entry as FileSystemFileHandle
              }
            }
            session = { dirHandle: dh, fileMap: fm }
            sessionStore[folderDbId] = session
          } catch { showToast('Skipped — access denied', 'error'); continue }
        }
        // Create "CustomerName Selected" subfolder inside the source directory
        destDir = await session.dirHandle.getDirectoryHandle(destFolderName, { create: true })
      } else {
        // Uploaded-files mode: ask user to pick a destination folder
        showToast(`📂 Pick a destination folder to save "${destFolderName}"`)
        try {
          const dh = await window.showDirectoryPicker!({ mode: 'readwrite', startIn: 'pictures' })
          destDir = await dh.getDirectoryHandle(destFolderName, { create: true })
        } catch { showToast('Skipped — destination folder not selected', 'error'); continue }
      }

      for (const meta of group) {
        const srcHandle = session.fileMap[meta.originalName]
        const uploadedFile = uploadedFilesMap[folderDbId]?.[meta.originalName]

        if (!srcHandle && !uploadedFile) {
          showToast(`⚠ File not found in folder: ${meta.originalName}`, 'error')
          written++
          setSaveProgress({ current: written, total: selectedMeta.length })
          continue
        }

        // Read full-res file — from uploaded File object or disk handle
        const arrayBuffer = uploadedFile
          ? await uploadedFile.arrayBuffer()
          : await (await srcHandle!.getFile()).arrayBuffer()

        // Write to destination folder
        const safeName = meta.originalName.replace(/[/\\?%*:|"<>]/g, '_')
        const destHandle = await destDir.getFileHandle(safeName, { create: true })
        const writable = await destHandle.createWritable()
        await writable.write(arrayBuffer)
        await writable.close()

        written++
        setSaveProgress({ current: written, total: selectedMeta.length })
      }
    }

    // Mark as saved in DB
    await fetch('/api/admin/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: id }),
    })

    showToast(`✅ ${written} full-resolution photos saved to "${destFolderName}"`)
    setSaving(false)
    setSaveProgress({ current: 0, total: 0 })
    load()
  }

  async function resetSelection() {
    if (!confirm('Reset customer selection so they can re-select? This clears all current selections.')) return
    setResetting(true)
    try {
      const r = await fetch(`/api/admin/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock' }),
      })
      if (r.ok) { showToast('Selection reset — customer can now re-select'); load() }
      else showToast('Reset failed', 'error')
    } finally { setResetting(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="spinner" />
    </div>
  )
  if (!customer) return <div style={{ padding: 40, color: '#f87171' }}>Customer not found</div>

  const selectedPhotos = photos.filter(p => p.isSelected)
  const savedPhotos = photos.filter(p => p.savedToFolder)
  const activeFolderPhotos = activeFolder ? photos.filter(p => p.folderDbId === activeFolder.id) : []
  const hasSession = activeFolder ? !!sessionStore[activeFolder.id] : false

  return (
    <div style={{ padding: '36px 44px' }}>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* Processing overlay */}
      {(processing || saving) && (
        <div style={{ position: 'fixed', bottom: 80, right: 24, background: '#0f0f0f', border: '1px solid rgba(212,160,23,0.3)', borderRadius: 14, padding: '18px 22px', zIndex: 2000, minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {processing && (
            <>
              <p style={{ color: '#f0d78c', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                🖼 {processProgress.phase}
              </p>
              <p style={{ color: '#8a8070', fontSize: 12, marginBottom: 10 }}>
                {processProgress.current} / {processProgress.total} photos — full-res stays on your disk
              </p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%` }} />
              </div>
            </>
          )}
          {saving && (
            <>
              <p style={{ color: '#f0d78c', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                💾 Copying full-res photos…
              </p>
              <p style={{ color: '#8a8070', fontSize: 12, marginBottom: 10 }}>
                {saveProgress.current} / {saveProgress.total} files copied
              </p>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${saveProgress.total > 0 ? (saveProgress.current / saveProgress.total) * 100 : 0}%` }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* FS API error */}
      {fsSupportError && (
        <div className="modal-overlay" onClick={() => setFsSupportError(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 36, maxWidth: 420, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8', marginBottom: 10 }}>Browser Not Supported</h2>
            <p style={{ color: '#8a8070', fontSize: 14, marginBottom: 16 }}>Folder access requires the <strong style={{ color: '#f0d78c' }}>File System Access API</strong>.</p>
            <p style={{ color: '#555', fontSize: 13, marginBottom: 24 }}>Use <strong style={{ color: '#f0d78c' }}>Google Chrome</strong> or <strong style={{ color: '#f0d78c' }}>Microsoft Edge</strong> v86+ on desktop.</p>
            <button className="btn-gold" onClick={() => setFsSupportError(false)} style={{ padding: '11px 28px', borderRadius: 9, fontSize: 14 }}>Got it</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/customers" style={{ color: '#8a8070', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          ← Back to Clients
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: '#f5f0e8', marginBottom: 4 }}>{customer.name}</h1>
            <p style={{ color: '#8a8070', fontSize: 13 }}>{customer.eventName}{customer.eventDate && ` · ${customer.eventDate}`}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {customer.selectionLocked && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 20, padding: '7px 14px' }}>
                  <span>🔒</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa' }}>Selection Submitted</span>
                </div>
                <button onClick={resetSelection} disabled={resetting} className="btn-outline"
                  style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)' }}>
                  {resetting ? 'Resetting…' : '🔄 Reset & Allow Re-selection'}
                </button>
              </>
            )}
            {selectedPhotos.length > 0 && (
              <button className="btn-gold" onClick={saveSelectedToFolder} disabled={saving}
                style={{ padding: '11px 22px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {saving ? '⏳ Copying…' : `📁 Save Selected to Folder (${selectedPhotos.length})`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Architecture info banner */}
      <div style={{ background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 12, padding: '14px 20px', marginBottom: 22, display: 'flex', gap: 12 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>ℹ️</span>
        <div>
          <p style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>No files are uploaded to the server</p>
          <p style={{ fontSize: 12, color: '#8a8070', lineHeight: 1.6 }}>
            Full-resolution photos <strong style={{ color: '#fff' }}>stay on your computer</strong>. Only small preview thumbnails (~20 KB each) are stored in the database for customer browsing.
            When saving selected photos, the app reads the originals directly from your disk and copies them into the <strong style={{ color: '#f0d78c' }}>"{customer.name} Selected"</strong> subfolder — original quality, zero server storage.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 26 }}>
        <div className="stat-card">
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Contact</p>
          <p style={{ fontSize: 13, color: '#f5f0e8', fontWeight: 600 }}>{customer.phone}</p>
          <p style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{customer.email}</p>
        </div>
        <div className="stat-card">
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Access Code</p>
          <p style={{ fontFamily: 'monospace', fontSize: 15, color: '#f0d78c', fontWeight: 700 }}>{customer.accessCode}</p>
          <p style={{ fontSize: 10, color: '#555', marginTop: 3 }}>Share via SMS</p>
        </div>
        <div className="stat-card">
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Photos Registered</p>
          <p style={{ fontSize: 30, fontWeight: 700, color: '#d4a017', fontFamily: "'Playfair Display', serif" }}>{customer.photoCount}</p>
          <p style={{ fontSize: 10, color: '#555' }}>Thumbnails in DB · Full-res on disk</p>
        </div>
        <div className="stat-card">
          <p style={{ fontSize: 10, color: '#8a8070', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Selected</p>
          <p style={{ fontSize: 30, fontWeight: 700, color: '#4ade80', fontFamily: "'Playfair Display', serif" }}>
            {customer.selectedCount}
            {customer.maxSelectCount > 0 && <span style={{ fontSize: 14, color: '#555', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>/{customer.maxSelectCount}</span>}
          </p>
          {savedPhotos.length > 0 && <p style={{ fontSize: 10, color: '#60a5fa' }}>✓ {savedPhotos.length} copied to disk</p>}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '264px 1fr', gap: 22, alignItems: 'start' }}>

        {/* LEFT: Folders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8' }}>📁 Folders</h2>
              <button className="btn-gold" onClick={() => setShowFolderModal(true)} style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12 }}>+ New</button>
            </div>

            {folders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#444', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                Create a folder, then pick a local folder to register photos from.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {folders.map(folder => {
                  const isActive = activeFolder?.id === folder.id
                  const isLinked = !!sessionStore[folder.id]
                  const label = linkedLabels[folder.id] || folder.localSourcePath
                  return (
                    <div key={folder.id}
                      onClick={() => setActiveFolder(isActive ? null : folder)}
                      style={{
                        padding: '10px 12px', borderRadius: 9, cursor: 'pointer', transition: 'all 0.2s',
                        background: isActive ? 'rgba(212,160,23,0.12)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isActive ? 'rgba(212,160,23,0.35)' : '#1e1e1e'}`,
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#f0d78c' : '#f5f0e8', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            📁 {folder.name}
                          </p>
                          {label && (
                            <p style={{ fontSize: 10, color: isLinked ? '#4ade80' : '#555', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isLinked ? '🔗' : '📂'} {label}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <span className="badge badge-gold" style={{ fontSize: 10 }}>{folder.photoCount} photos</span>
                            {isLinked
                              ? <span className="badge badge-green" style={{ fontSize: 10 }}>Linked ✓</span>
                              : folder.localSourcePath
                                ? <button
                                    onClick={e => { e.stopPropagation(); relinkFolder(folder) }}
                                    style={{ fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                                    Re-link
                                  </button>
                                : null
                            }
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); deleteFolder(folder) }}
                          style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: '0 0 0 6px', flexShrink: 0 }}>🗑</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Selected summary */}
          {selectedPhotos.length > 0 && (
            <div className="glass-card" style={{ padding: 16 }}>
              <p style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>✅ {selectedPhotos.length} selected by customer</p>
              <div style={{ background: 'rgba(212,160,23,0.07)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: '#8a8070', marginBottom: 2 }}>Will be saved as:</p>
                <p style={{ fontSize: 12, color: '#f0d78c', fontFamily: 'monospace', fontWeight: 600 }}>📁 {customer.name} Selected/</p>
                <p style={{ fontSize: 10, color: '#555', marginTop: 2 }}>inside the original upload folder</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {selectedPhotos.map(p => (
                  <div key={p.id} style={{ fontSize: 11, color: '#8a8070', background: '#111', borderRadius: 5, padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.originalName}</span>
                    {p.savedToFolder && <span style={{ color: '#60a5fa', fontSize: 9, flexShrink: 0 }}>✓ saved</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div>
          {!activeFolder ? (
            <div className="glass-card" style={{ padding: 56, textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>📂</div>
              <p style={{ color: '#f5f0e8', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Select a folder to get started</p>
              <p style={{ color: '#555', fontSize: 13 }}>Choose a folder from the left, or create a new one.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 22 }}>📁</span>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600, color: '#f0d78c', marginBottom: 2 }}>{activeFolder.name}</h2>
                  {(linkedLabels[activeFolder.id] || activeFolder.localSourcePath) && (
                    <p style={{ fontSize: 11, color: hasSession ? '#4ade80' : '#8a8070', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {hasSession ? '🔗 Linked:' : '📂 Last used:'}
                      <span style={{ fontFamily: 'monospace' }}>{linkedLabels[activeFolder.id] || activeFolder.localSourcePath}</span>
                    </p>
                  )}
                </div>
                <span className="badge badge-gold">{activeFolderPhotos.length} photos</span>
              </div>

              {/* Upload zone */}
              <div className="glass-card" style={{ padding: 22, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8', marginBottom: 3 }}>Register Photos</p>
                    <p style={{ fontSize: 11, color: '#555' }}>Thumbnails stored in DB · Full-res stays on your disk</p>
                  </div>
                  {hasSession && <span style={{ fontSize: 11, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 20, padding: '3px 10px' }}>🔗 Folder linked</span>}
                </div>

                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 4 }}>
                  <button
                    onClick={() => setUploadMode('folder')}
                    style={{
                      flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', border: 'none', transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif",
                      background: uploadMode === 'folder' ? 'rgba(212,160,23,0.18)' : 'transparent',
                      color: uploadMode === 'folder' ? '#f0d78c' : '#555',
                    }}>
                    📂 Pick Folder
                  </button>
                  <button
                    onClick={() => setUploadMode('files')}
                    style={{
                      flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', border: 'none', transition: 'all 0.2s', fontFamily: "'DM Sans', sans-serif",
                      background: uploadMode === 'files' ? 'rgba(212,160,23,0.18)' : 'transparent',
                      color: uploadMode === 'files' ? '#f0d78c' : '#555',
                    }}>
                    🖼 Upload Photos
                  </button>
                </div>

                {processing ? (
                  <div style={{ textAlign: 'center', padding: '28px 0' }}>
                    <div className="spinner" style={{ margin: '0 auto 14px' }} />
                    <p style={{ color: '#f0d78c', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                      {processProgress.phase} ({processProgress.current}/{processProgress.total})
                    </p>
                    <div className="progress-bar" style={{ maxWidth: 340, margin: '0 auto' }}>
                      <div className="progress-fill" style={{ width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%` }} />
                    </div>
                    <p style={{ color: '#555', fontSize: 11, marginTop: 10 }}>Generating previews in browser — full-res photos never leave your computer</p>
                  </div>
                ) : uploadMode === 'folder' ? (
                  <button onClick={pickFolderAndProcess}
                    style={{
                      width: '100%', padding: '28px 20px', borderRadius: 12, cursor: 'pointer',
                      background: 'rgba(212,160,23,0.05)', border: '2px dashed rgba(212,160,23,0.3)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'all 0.25s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.1)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.6)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.05)'; e.currentTarget.style.borderColor = 'rgba(212,160,23,0.3)' }}>
                    <span style={{ fontSize: 36 }}>📂</span>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ color: '#f0d78c', fontWeight: 700, fontSize: 15, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                        {hasSession ? 'Pick Another Folder' : 'Pick Folder & Register Photos'}
                      </p>
                      <p style={{ color: '#8a8070', fontSize: 12 }}>
                        Select the event folder from your computer. Previews are generated here in the browser — original files never upload.
                      </p>
                    </div>
                  </button>
                ) : (
                  <>
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => uploadFilesAndProcess(e.target.files)}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: '100%', padding: '28px 20px', borderRadius: 12, cursor: 'pointer',
                        background: 'rgba(96,165,250,0.04)', border: '2px dashed rgba(96,165,250,0.3)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'all 0.25s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.09)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.6)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(96,165,250,0.04)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)' }}>
                      <span style={{ fontSize: 36 }}>🖼️</span>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ color: '#93c5fd', fontWeight: 700, fontSize: 15, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                          Select Photos to Upload
                        </p>
                        <p style={{ color: '#8a8070', fontSize: 12 }}>
                          Pick individual image files from your computer. Works in all browsers — thumbnails generated locally.
                        </p>
                      </div>
                    </button>
                  </>
                )}
              </div>

              {/* Photo grid */}
              {activeFolderPhotos.length > 0 && (
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8' }}>Photos in this folder</p>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <span className="badge badge-gold">{activeFolderPhotos.length}</span>
                      <span className="badge badge-green">{activeFolderPhotos.filter(p => p.isSelected).length} selected</span>
                      {activeFolderPhotos.filter(p => p.savedToFolder).length > 0 && (
                        <span className="badge badge-blue">{activeFolderPhotos.filter(p => p.savedToFolder).length} saved</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 7 }}>
                    {activeFolderPhotos.map(photo => (
                      <div key={photo.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '1', background: '#111' }}
                        title={photo.originalName}>
                        <img
                          src={photo.thumbnailUrl}
                          alt={photo.originalName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        {photo.isSelected && (
                          <div style={{ position: 'absolute', top: 4, right: 4, background: '#4ade80', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#0a0a0a', fontWeight: 700 }}>✓</div>
                        )}
                        {photo.savedToFolder && (
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(96,165,250,0.75)', padding: '2px 0', fontSize: 9, color: '#fff', textAlign: 'center', fontWeight: 700 }}>SAVED</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating counter */}
      <div className="floating-counter">
        🖼 {customer.photoCount} · ✅ {customer.selectedCount}{customer.maxSelectCount > 0 ? `/${customer.maxSelectCount}` : ''}
      </div>

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ padding: 32, maxWidth: 420, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f5f0e8' }}>Create New Folder</h2>
              <button onClick={() => setShowFolderModal(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <form onSubmit={createFolder}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Folder Name <span style={{ color: '#d4a017' }}>*</span>
                </label>
                <input className="input-dark" value={folderForm.name}
                  onChange={e => setFolderForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Wedding Ceremony, Reception" required
                  style={{ padding: '11px 13px', fontSize: 14 }} autoFocus />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8a8070', marginBottom: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Description</label>
                <input className="input-dark" value={folderForm.description}
                  onChange={e => setFolderForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional notes" style={{ padding: '11px 13px', fontSize: 14 }} />
              </div>
              <div style={{ background: 'rgba(212,160,23,0.06)', border: '1px solid rgba(212,160,23,0.15)', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: '#8a8070', lineHeight: 1.5 }}>
                  💡 After creating, click <strong style={{ color: '#f0d78c' }}>📂 Pick Folder & Register Photos</strong> to select the event folder from your computer. Previews are generated in the browser — your full-res photos never leave your disk.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setShowFolderModal(false)} className="btn-outline" style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 14 }}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={savingFolder} style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 14 }}>
                  {savingFolder ? 'Creating…' : '📁 Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

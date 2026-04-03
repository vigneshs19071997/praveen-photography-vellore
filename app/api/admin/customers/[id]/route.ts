import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { customers, photos } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId))
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const customerPhotos = await db
    .select({
      id: photos.id,
      customerId: photos.customerId,
      folderDbId: photos.folderDbId,
      folderName: photos.folderName,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      size: photos.size,
      thumbnailUrl: photos.thumbnailUrl,
      isSelected: photos.isSelected,
      selectedAt: photos.selectedAt,
      savedToFolder: photos.savedToFolder,
      savedAt: photos.savedAt,
      uploadedAt: photos.uploadedAt,
    })
    .from(photos)
    .where(eq(photos.customerId, customerId))
    .orderBy(photos.uploadedAt)

  return NextResponse.json({ customer, photos: customerPhotos })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)
  // photos cascade delete due to FK constraint; explicit delete for safety
  await db.delete(photos).where(eq(photos.customerId, customerId))
  await db.delete(customers).where(eq(customers.id, customerId))
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const customerId = parseInt(id)
  const { action } = await req.json()

  if (action === 'unlock') {
    await db
      .update(photos)
      .set({ isSelected: false, selectedAt: null })
      .where(eq(photos.customerId, customerId))

    await db
      .update(customers)
      .set({ selectionLocked: false, selectionLockedAt: null, selectedCount: 0 })
      .where(eq(customers.id, customerId))

    return NextResponse.json({ success: true, message: 'Selection reset and unlocked' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')
  if (!customerId) return NextResponse.json({ error: 'Missing customerId' }, { status: 400 })

  const selectedPhotos = await db
    .select({
      id: photos.id,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      folderDbId: photos.folderDbId,
      folderName: photos.folderName,
      selectedAt: photos.selectedAt,
    })
    .from(photos)
    .where(and(eq(photos.customerId, parseInt(customerId)), eq(photos.isSelected, true)))
    .orderBy(photos.selectedAt)

  if (!selectedPhotos.length) return NextResponse.json({ error: 'No selected photos' }, { status: 404 })

  return NextResponse.json({ photos: selectedPhotos })
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { customerId } = await req.json()

  await db
    .update(photos)
    .set({ savedToFolder: true, savedAt: new Date() })
    .where(and(eq(photos.customerId, parseInt(customerId)), eq(photos.isSelected, true), eq(photos.savedToFolder, false)))

  return NextResponse.json({ success: true })
}

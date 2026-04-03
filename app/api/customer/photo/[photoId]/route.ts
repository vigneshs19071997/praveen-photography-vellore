import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { photoId: string } }) {
  const token = getTokenFromRequest(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const decoded = verifyToken(token)
  if (!decoded) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const photoId = parseInt(params.photoId)
  const condition =
    decoded.role === 'admin'
      ? eq(photos.id, photoId)
      : and(eq(photos.id, photoId), eq(photos.customerId, parseInt(decoded.id)))

  const [photo] = await db
    .select({
      id: photos.id,
      originalName: photos.originalName,
      mimeType: photos.mimeType,
      thumbnailUrl: photos.thumbnailUrl,
      folderDbId: photos.folderDbId,
      folderName: photos.folderName,
      isSelected: photos.isSelected,
      uploadedAt: photos.uploadedAt,
    })
    .from(photos)
    .where(condition)

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(photo)
}

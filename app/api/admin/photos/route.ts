import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { photos, folders, customers } from '@/lib/schema'
import { eq, and, count } from 'drizzle-orm'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'
import { uploadThumbnailToCloudinary } from '@/lib/cloudinary'

function adminAuth(req: NextRequest) {
  const token = getTokenFromRequest(req)
  if (!token) return null
  const decoded = verifyToken(token)
  if (!decoded || decoded.role !== 'admin') return null
  return decoded
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { customerId, folderDbId, photos: photoList } = body

  if (!customerId || !folderDbId || !Array.isArray(photoList) || !photoList.length) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }

  const cId = parseInt(customerId)
  const fId = parseInt(folderDbId)

  const [customer] = await db.select().from(customers).where(eq(customers.id, cId))
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const [folder] = await db.select().from(folders).where(eq(folders.id, fId))
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const errors: string[] = []

  // Upload all photos to Cloudinary in parallel (6 concurrent workers)
  const validPhotos = photoList.filter((p: any) => p.originalName && p.thumbnailData)
  type UploadResult = { originalName: string; secure_url: string; public_id: string; mimeType: string; size: number }
  const uploadResults: (UploadResult | null)[] = new Array(validPhotos.length).fill(null)

  let workerIdx = 0
  async function uploadWorker() {
    while (workerIdx < validPhotos.length) {
      const i = workerIdx++
      const p = validPhotos[i]
      try {
        const { secure_url, public_id } = await uploadThumbnailToCloudinary(
          p.thumbnailData,
          p.mimeType || 'image/jpeg',
          `praveen-photography/${customerId}`
        )
        uploadResults[i] = { originalName: p.originalName, secure_url, public_id, mimeType: p.mimeType || 'image/jpeg', size: p.size || 0 }
      } catch (err) {
        console.error(`Failed to upload ${p.originalName}:`, err)
        errors.push(p.originalName)
      }
    }
  }
  await Promise.all(Array.from({ length: 10 }, uploadWorker))

  // Batch insert all successful uploads in one query
  const successful = uploadResults.filter(Boolean) as UploadResult[]
  let insertedIds: number[] = []
  if (successful.length > 0) {
    const rows = await db
      .insert(photos)
      .values(successful.map(r => ({
        customerId: cId,
        folderDbId: fId,
        folderName: folder.name,
        originalName: r.originalName,
        mimeType: r.mimeType,
        size: r.size,
        thumbnailUrl: r.secure_url,
        cloudinaryPublicId: r.public_id,
      })))
      .returning({ id: photos.id })
    insertedIds = rows.map(r => r.id)
  }

  // Update folder and customer counts in parallel
  const [[folderCountRow], [totalRow]] = await Promise.all([
    db.select({ value: count() }).from(photos).where(eq(photos.folderDbId, fId)),
    db.select({ value: count() }).from(photos).where(eq(photos.customerId, cId)),
  ])
  await Promise.all([
    db.update(folders).set({ photoCount: folderCountRow.value }).where(eq(folders.id, fId)),
    db.update(customers).set({ photoCount: totalRow.value }).where(eq(customers.id, cId)),
  ])

  return NextResponse.json({
    success: true,
    uploaded: insertedIds.length,
    failed: errors.length,
    failedFiles: errors,
    total: totalRow.value,
  })
}

export async function GET(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId')
  const folderDbId = searchParams.get('folderDbId')

  let query = db
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
    .$dynamic()

  const conditions = []
  if (customerId) conditions.push(eq(photos.customerId, parseInt(customerId)))
  if (folderDbId) conditions.push(eq(photos.folderDbId, parseInt(folderDbId)))
  if (conditions.length) query = query.where(and(...conditions))

  const rows = await query.orderBy(photos.uploadedAt)
  return NextResponse.json(rows)
}

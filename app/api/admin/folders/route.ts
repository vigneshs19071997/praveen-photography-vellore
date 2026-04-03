import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { folders, photos } from '@/lib/schema'
import { eq, desc } from 'drizzle-orm'
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

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.customerId, parseInt(customerId)))
    .orderBy(desc(folders.createdAt))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { customerId, name, description, localSourcePath } = await req.json()
  if (!customerId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const [folder] = await db
    .insert(folders)
    .values({
      customerId: parseInt(customerId),
      name: name.trim(),
      description: description || '',
      localSourcePath: localSourcePath || '',
    })
    .returning()

  return NextResponse.json(folder, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId, localSourcePath } = await req.json()
  if (!folderId) return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })

  const [folder] = await db
    .update(folders)
    .set({ localSourcePath })
    .where(eq(folders.id, parseInt(folderId)))
    .returning()

  return NextResponse.json(folder)
}

export async function DELETE(req: NextRequest) {
  if (!adminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const folderId = searchParams.get('folderId')
  if (!folderId) return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })

  // photos cascade via FK; explicit delete for safety
  await db.delete(photos).where(eq(photos.folderDbId, parseInt(folderId)))
  await db.delete(folders).where(eq(folders.id, parseInt(folderId)))

  return NextResponse.json({ success: true })
}

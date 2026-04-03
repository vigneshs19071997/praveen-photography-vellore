import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { admins } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()

    let [admin] = await db.select().from(admins).where(eq(admins.username, username))

    if (!admin && username === 'admin') {
      const hash = await bcrypt.hash(password || 'admin123', 12)
      const [created] = await db
        .insert(admins)
        .values({ username: 'admin', passwordHash: hash })
        .returning()
      admin = created
    }

    if (!admin) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ id: String(admin.id), role: 'admin', username })
    const res = NextResponse.json({ success: true, role: 'admin' })
    res.cookies.set('token', token, { httpOnly: true, maxAge: 86400, path: '/' })
    return res
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

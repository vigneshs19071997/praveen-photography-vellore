import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { admins } from '../lib/schema'
import bcrypt from 'bcryptjs'
import * as schema from '../lib/schema'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set')
  process.exit(1)
}

const client = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(client, { schema })

async function seed() {
  try {
    console.log('🌱 Starting database seed...')

    // Hash the password
    const password = 'admin123' // Change this to your desired password
    const passwordHash = await bcrypt.hash(password, 10)

    // Insert admin user
    const result = await db
      .insert(admins)
      .values({
        username: 'admin',
        passwordHash: passwordHash,
      })
      .returning()

    console.log('✅ Admin user created successfully!')
    console.log('Admin Details:')
    console.log(`  Username: ${result[0].username}`)
    console.log(`  ID: ${result[0].id}`)
    console.log(`  Password: ${password} (keep this safe!)`)
    
    await client.end()
  } catch (error: any) {
    if (error.message.includes('unique constraint')) {
      console.log('⚠️  Admin user already exists. Skipping...')
      await client.end()
    } else {
      console.error('❌ Error seeding database:', error)
      await client.end()
      process.exit(1)
    }
  }
}

seed()

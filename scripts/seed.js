require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') })

const postgres = require('postgres')
const bcrypt = require('bcryptjs')

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set')
  process.exit(1)
}

async function seed() {
  const sql = postgres(DATABASE_URL)
  
  try {
    console.log('🌱 Starting database seed...')

    // Hash the password
    const password = 'admin123' // Change this to your desired password
    const passwordHash = await bcrypt.hash(password, 10)

    // Insert admin user
    const result = await sql`
      INSERT INTO admins (username, password_hash)
      VALUES (${'admin'}, ${passwordHash})
      RETURNING id, username
    `

    if (result && result.length > 0) {
      console.log('✅ Admin user created successfully!')
      console.log('Admin Details:')
      console.log(`  Username: ${result[0].username}`)
      console.log(`  ID: ${result[0].id}`)
      console.log(`  Password: ${password} (keep this safe!)`)
    }
    
    await sql.end()
  } catch (error) {
    console.error('❌ Error seeding database:', error.message)
    await sql.end()
    process.exit(1)
  }
}

seed()


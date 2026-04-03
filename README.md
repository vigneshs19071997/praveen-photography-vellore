# Praveen Photography — Next.js + Cloudinary + PostgreSQL (Drizzle ORM)

A photo selection platform for photography clients. Admins upload compressed thumbnails to Cloudinary; customers browse and select their favourites. Full-resolution files never leave the admin's local disk.

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Framework   | Next.js 14 (App Router)             |
| Database    | **PostgreSQL** via **Drizzle ORM**  |
| Storage     | Cloudinary (thumbnails only)        |
| Auth        | JWT (httpOnly cookies)              |
| Styling     | Tailwind CSS                        |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
# Fill in DATABASE_URL, JWT_SECRET, and Cloudinary credentials
```

### 3. Set up the database

**Option A — Push schema directly (fastest for dev):**
```bash
npm run db:push
```

**Option B — Generate & run migrations (recommended for production):**
```bash
npm run db:generate   # creates SQL files in /drizzle
npm run db:migrate    # applies them to the DB
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Database Schema

Four tables, all defined in `lib/schema.ts`:

| Table       | Description                                      |
|-------------|--------------------------------------------------|
| `admins`    | Admin login credentials                          |
| `customers` | Client records with event info & selection state |
| `folders`   | Photo folders per customer                       |
| `photos`    | Thumbnail metadata + Cloudinary URLs             |

IDs are **serial integers** (auto-increment). All foreign keys use `ON DELETE CASCADE`.

---

## Drizzle Scripts

| Script              | What it does                                  |
|---------------------|-----------------------------------------------|
| `npm run db:generate` | Generate SQL migrations from `lib/schema.ts` |
| `npm run db:migrate`  | Apply pending migrations to the database     |
| `npm run db:push`     | Push schema changes directly (dev only)      |
| `npm run db:studio`   | Open Drizzle Studio (visual DB browser)      |

---

## Migration from MongoDB

The original project used Mongoose. Changes made during migration:

- **Removed** `mongoose` dependency → replaced with `drizzle-orm` + `postgres`
- **Removed** `models/` folder (Mongoose schemas) → replaced with `lib/schema.ts` (Drizzle table definitions)
- **Replaced** `lib/db.ts` (mongoose connection) → Drizzle `postgres-js` client
- **All API routes** rewritten to use Drizzle query builder (`db.select`, `db.insert`, `db.update`, `db.delete`)
- **IDs** changed from MongoDB ObjectId strings → PostgreSQL serial integers
- **`connectDB()`** call removed from all routes (Drizzle connects lazily via the pool)
- **`.env.local`**: replace `MONGODB_URI` with `DATABASE_URL`

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── auth/admin/         # Admin login
│   │   ├── auth/customer/      # Customer access-code login
│   │   ├── auth/logout/        # Logout
│   │   ├── admin/customers/    # CRUD customers
│   │   ├── admin/folders/      # CRUD folders
│   │   ├── admin/photos/       # Upload & manage photos
│   │   ├── admin/stats/        # Dashboard stats
│   │   ├── admin/download/     # Get selected photos list
│   │   ├── customer/gallery/   # Customer gallery view
│   │   ├── customer/select/    # Toggle / confirm selections
│   │   └── customer/photo/     # Single photo fetch
│   ├── admin/                  # Admin UI pages
│   ├── customer/               # Customer UI pages
│   └── login/                  # Login page
├── lib/
│   ├── schema.ts               # ✅ Drizzle table definitions (replaces models/)
│   ├── db.ts                   # ✅ Drizzle client (replaces mongoose connect)
│   ├── auth.ts                 # JWT helpers
│   └── cloudinary.ts           # Cloudinary upload/delete helpers
├── drizzle/                    # Generated SQL migration files
├── drizzle.config.ts           # Drizzle Kit config
└── .env.local.example
```

---

## Supported PostgreSQL Providers

Any standard PostgreSQL connection string works:

- **Local** — `postgresql://postgres:password@localhost:5432/praveen_photography`
- **Neon** — `postgresql://user:pass@ep-xxx.aws.neon.tech/db?sslmode=require`
- **Supabase** — `postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres`
- **Railway / Render / Fly.io** — use the `DATABASE_URL` they provide

/**
 * lib/cloudinary.ts
 *
 * Server-side Cloudinary helpers.
 * Uses the REST Upload API (no SDK dependency) — just fetch + FormData.
 *
 * Required env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

import crypto from 'crypto'

const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME!
const API_KEY     = process.env.CLOUDINARY_API_KEY!
const API_SECRET  = process.env.CLOUDINARY_API_SECRET!

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  throw new Error(
    'Missing Cloudinary env vars. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
  )
}

/** Result returned after a successful thumbnail upload */
export interface CloudinaryUploadResult {
  public_id: string   // e.g. "praveen-photography/thumbnails/abc123"
  secure_url: string  // e.g. "https://res.cloudinary.com/..."
}

/**
 * Upload a base64-encoded thumbnail to Cloudinary.
 *
 * @param base64Data  Raw base64 string (no data-URI prefix)
 * @param mimeType    e.g. "image/jpeg"
 * @param folder      Cloudinary folder path, default "praveen-photography/thumbnails"
 * @returns           { public_id, secure_url }
 */
export async function uploadThumbnailToCloudinary(
  base64Data: string,
  mimeType: string = 'image/jpeg',
  folder: string = 'praveen-photography/thumbnails'
): Promise<CloudinaryUploadResult> {
  const timestamp = Math.floor(Date.now() / 1000)

  // Build the signature string (alphabetical param order, no api_key / file)
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${API_SECRET}`
  const signature = crypto.createHash('sha1').update(signaturePayload).digest('hex')

  const formData = new FormData()
  formData.append('file', `data:${mimeType};base64,${base64Data}`)
  formData.append('api_key', API_KEY)
  formData.append('timestamp', String(timestamp))
  formData.append('signature', signature)
  formData.append('folder', folder)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Cloudinary upload failed: ${err}`)
  }

  const json = await res.json()
  return { public_id: json.public_id, secure_url: json.secure_url }
}

/**
 * Delete an image from Cloudinary by its public_id.
 * Called when a photo record is deleted from MongoDB.
 */
export async function deleteThumbnailFromCloudinary(publicId: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000)

  const signaturePayload = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`
  const signature = crypto.createHash('sha1').update(signaturePayload).digest('hex')

  const formData = new FormData()
  formData.append('public_id', publicId)
  formData.append('api_key', API_KEY)
  formData.append('timestamp', String(timestamp))
  formData.append('signature', signature)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`,
    { method: 'POST', body: formData }
  )

  if (!res.ok) {
    const err = await res.text()
    // Log but don't throw — a failed deletion shouldn't break the main flow
    console.error(`Cloudinary delete failed for ${publicId}: ${err}`)
  }
}

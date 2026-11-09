/**
 * Shrink a user-picked image to a small square-ish thumbnail data URL before storing it
 * in the database, so a phone photo doesn't add megabytes per product.
 */
export async function resizeImageFile(file: File, maxSize = 320, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Image is larger than 15 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image processing is not available in this browser.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    const webp = canvas.toDataURL('image/webp', quality)
    // Safari < 14 silently falls back to PNG for unsupported types; prefer JPEG there.
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

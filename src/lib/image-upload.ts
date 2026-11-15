/**
 * Prepares a picked image for upload: decodes it, scales it down and re-encodes it as a small data URL,
 * so a 5 MB phone photo becomes a logo or profile picture of a few dozen KB. Browser only.
 */

export type ImageErrorCode = 'type' | 'decode'
export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code)
  }
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
export const IMAGE_ACCEPT = ACCEPTED.join(',')

interface Options {
  /** Longest side in pixels. */
  size: number
  /** `cover` crops to a size x size square (profile pictures); `contain` keeps the shape (logos). */
  mode: 'cover' | 'contain'
  /** Stop shrinking once the data URL is this many characters or fewer. */
  maxChars: number
}

export async function imageToDataUrl(file: File, { size, mode, maxChars }: Options): Promise<string> {
  if (!ACCEPTED.includes(file.type)) throw new ImageError('type')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError('decode')
  }
  try {
    let side = size
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = draw(bitmap, side, mode)
      if (url.length <= maxChars) return url
      side = Math.round(side * 0.75)
    }
    return draw(bitmap, Math.max(64, side), mode)
  } finally {
    bitmap.close()
  }
}

function draw(bitmap: ImageBitmap, size: number, mode: 'cover' | 'contain'): string {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageError('decode')
  if (mode === 'cover') {
    canvas.width = canvas.height = size
    const crop = Math.min(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size)
  } else {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  // WebP keeps transparency and is small; browsers that cannot encode it fall back to PNG, which the server accepts too.
  return canvas.toDataURL('image/webp', 0.86)
}

/** Client-side unique IDs. crypto.randomUUID is available in all PWA-capable browsers (secure context). */
export function newId(): string {
  return crypto.randomUUID()
}

/** A fresh idempotency key for one user-initiated submission (e.g. one "Complete sale" click). */
export const newIdempotencyKey = newId

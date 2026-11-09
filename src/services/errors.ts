/** Error raised by business rules. `message` is safe to show to the user. */
export class BusinessError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BusinessError'
    this.code = code
  }
}

/** Turn any thrown value into a user-presentable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof BusinessError) return err.message
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name: unknown }).name)
    if (name === 'ConstraintError') return 'A record with the same unique value already exists.'
    if (name === 'QuotaExceededError') return 'Browser storage is full. Export a backup and free up space.'
    if (name === 'DatabaseClosedError' || name === 'InvalidStateError')
      return 'The local database is unavailable. Reload the app.'
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

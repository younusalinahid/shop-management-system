/** Error raised by business rules. `message` is safe to show to the user. */
export class BusinessError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BusinessError'
    this.code = code
  }
}

/** HTTP status for a business error code (used by the API layer). */
export function statusForCode(code: string): number {
  if (code === 'unauthorized') return 401
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code.startsWith('duplicate') || code === 'already_setup' || code === 'conflict') return 409
  return 400
}

/** Error returned by an API call; `message` comes from the server and is safe to show. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Turn any thrown value into a user-presentable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof BusinessError || err instanceof ApiError) return err.message
  if (err instanceof TypeError && /fetch/i.test(err.message)) return 'Cannot reach the server. Check the internet connection.'
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

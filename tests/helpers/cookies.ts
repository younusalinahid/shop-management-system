/** Set a request cookie for the in-process API (see the next/headers mock in tests/setup.ts). */
export function setTestCookie(name: string, value: string) {
  ;(globalThis as { __testCookies?: Map<string, string> }).__testCookies?.set(name, value)
}

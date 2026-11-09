import { VALIDATION_PREFIX } from './config'

type Values = Record<string, string | number>
/** A translator looked up by runtime keys (e.g. "errors." + code); next-intl's own type only accepts literal keys. */
export type Translator = { (key: string, values?: Values): string; has: (key: string) => boolean }

/**
 * Show a validation message from a Zod schema: "v.nameRequired" → validation.nameRequired in the
 * current language. Plain strings (already human-readable) pass through unchanged.
 */
export function translateMessage(t: Translator, message: string, values?: Values): string {
  if (!message.startsWith(VALIDATION_PREFIX)) return message
  const key = `validation.${message.slice(VALIDATION_PREFIX.length)}`
  return t.has(key) ? t(key, values) : message
}

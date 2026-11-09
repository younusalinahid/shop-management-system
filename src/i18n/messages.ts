import type { Locale } from './config'
import en from '../../messages/en.json'

export type Messages = typeof en

export async function loadMessages(locale: Locale): Promise<Messages> {
  return locale === 'bn' ? (await import('../../messages/bn.json')).default : en
}

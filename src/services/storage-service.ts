/**
 * Browser storage persistence.
 *
 * All shop data lives in IndexedDB on this device. Browsers may evict "best-effort"
 * storage under disk pressure; asking for persistent storage makes eviction much less
 * likely, but the browser may refuse and NOTHING guarantees the data survives clearing
 * site data, uninstalling the browser, or device failure. Regular JSON backups are the
 * only real protection.
 */

export interface StorageStatus {
  supported: boolean
  persisted: boolean
  usageBytes?: number
  quotaBytes?: number
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!sm?.persisted) return { supported: false, persisted: false }
  const [persisted, estimate] = await Promise.all([
    sm.persisted().catch(() => false),
    sm.estimate ? sm.estimate().catch(() => undefined) : Promise.resolve(undefined),
  ])
  return { supported: true, persisted, usageBytes: estimate?.usage, quotaBytes: estimate?.quota }
}

/** Ask the browser to keep our data. Returns whether storage is now persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!sm?.persist) return false
  try {
    if (await sm.persisted()) return true
    return await sm.persist()
  } catch {
    return false
  }
}

export function formatBytes(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

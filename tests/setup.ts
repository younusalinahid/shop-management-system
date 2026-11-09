import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { db } from '@/db/database'

// jsdom lacks ResizeObserver, which Radix checkbox/switch use to size their hidden inputs.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Every test starts with an empty, freshly-migrated database.
beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => {
  db.close()
})

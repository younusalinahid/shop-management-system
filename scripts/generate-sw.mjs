// Generates the offline service worker for the static export in `out/`.
// Runs after `next build` (see package.json). Precaches every exported page and asset, so the
// whole app works offline after the first visit.
import { generateSW } from 'workbox-build'

const { count, size, warnings } = await generateSW({
  globDirectory: 'out',
  globPatterns: ['**/*.{html,js,css,txt,svg,png,ico,woff2,webmanifest}'],
  swDest: 'out/sw.js',
  // Query strings such as /products/view?id=… and Next's ?_rsc= resolve to the same cached file.
  ignoreURLParametersMatching: [/.*/],
  // Unknown paths fall back to the exported 404 page instead of the browser's offline error.
  navigateFallback: '/404.html',
  navigateFallbackDenylist: [/^\/_next\//, /\.[a-z0-9]+$/i],
  cleanupOutdatedCaches: true,
  // 'prompt' mode: the new worker waits until the user chooses to reload (see ReloadPrompt).
  skipWaiting: false,
  clientsClaim: false,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Next adds a content hash to every file under _next/static, so the URL itself is the version.
  dontCacheBustURLsMatching: /^_next\/static\//,
  // Workbox's precache route already maps /products -> products.html (cleanURLs) and / -> index.html.
})

for (const w of warnings) console.warn(w)
console.log(`Service worker: precached ${count} files (${(size / 1024).toFixed(0)} KiB)`)

'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` directly under <body>, hidden on screen. While printing (see `printNow`),
 * everything else on the page is hidden, so only this content reaches the printer.
 * `pageCss` sets the @page rule (paper / label size) for this print only.
 */
export function PrintPortal({ children, pageCss }: { children: ReactNode; pageCss?: string }) {
  useEffect(() => () => document.body.classList.remove('print-mode'), [])
  return createPortal(
    <div className="print-root">
      {pageCss && <style>{`@media print { @page { ${pageCss} } }`}</style>}
      {children}
    </div>,
    document.body,
  )
}

/** Print the mounted PrintPortal content. */
export function printNow() {
  document.body.classList.add('print-mode')
  const done = () => {
    document.body.classList.remove('print-mode')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

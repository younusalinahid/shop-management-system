import { useMemo } from 'react'
import { type BarcodeFormat, encodeBarcode } from '@/lib/barcode'
import { cn } from '@/lib/utils'

interface BarcodeSvgProps {
  value: string
  format?: BarcodeFormat
  /** Bar height in modules (1 module = narrowest bar). */
  height?: number
  showText?: boolean
  className?: string
}

/** Crisp, scalable barcode. Width follows the container; set it with className. */
export function BarcodeSvg({ value, format = 'CODE128', height = 50, showText = true, className }: BarcodeSvgProps) {
  const encoded = useMemo(() => {
    try {
      return encodeBarcode(value, format)
    } catch {
      return null
    }
  }, [value, format])

  if (!encoded) {
    return <p className={cn('text-xs text-destructive', className)}>Cannot draw barcode for “{value}”</p>
  }

  const quiet = 10
  const width = encoded.modules.length + quiet * 2
  const textH = showText ? 12 : 0
  const bars: Array<[number, number]> = []
  for (let i = 0; i < encoded.modules.length; ) {
    if (encoded.modules[i] === '1') {
      let j = i
      while (encoded.modules[j] === '1') j++
      bars.push([i, j - i])
      i = j
    } else i++
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height + textH}`}
      className={cn('block h-auto w-full bg-white text-black', className)}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect width={width} height={height + textH} fill="#fff" />
      {bars.map(([x, w]) => (
        <rect key={x} x={x + quiet} y={0} width={w} height={height} fill="#000" />
      ))}
      {showText && (
        <text x={width / 2} y={height + 10} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" fill="#000">
          {value}
        </text>
      )}
    </svg>
  )
}

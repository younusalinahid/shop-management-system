'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { downloadText } from '@/lib/csv'
import { errorMessage } from '@/lib/errors'
import { useRefreshData } from '@/hooks/use-catalog'
import { api } from '@/lib/api-client'
import { type ImportResult, type ParsedImport, parseProductCsv, productCsvTemplate } from '@/lib/product-csv'

/**
 * Two steps: pick a file and check it here (nothing sent yet), then POST it to /api/products/import,
 * which validates again and imports all new products in one transaction.
 */
export function ImportProductsDialog({ onClose }: { onClose: () => void }) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [csv, setCsv] = useState('')
  const refresh = useRefreshData()
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    if (file.size > 5 * 1024 * 1024) {
      setParsed({ products: [], errors: [{ line: 0, message: 'File is larger than 5 MB.' }] })
      return
    }
    const text = await file.text()
    setCsv(text)
    setParsed(parseProductCsv(text))
  }

  const run = async () => {
    if (!parsed) return
    setBusy(true)
    try {
      const res = await api.post<ImportResult>('/api/products/import', { csv })
      await refresh()
      const extras = [
        res.skipped.length && `${res.skipped.length} skipped (SKU already exists)`,
        res.createdCategories && `${res.createdCategories} new categories`,
        res.createdBrands && `${res.createdBrands} new brands`,
      ].filter(Boolean)
      toast.success(`${res.created} product(s) imported`, { description: extras.join(' · ') || undefined })
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const ok = parsed && parsed.errors.length === 0 && parsed.products.length > 0

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>
            One row per unit. Rows with the same SKU make one product. Existing SKUs are skipped, never overwritten. Prices are in taka, minimum stock in base
            units.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={() => downloadText('product-import-template.csv', productCsvTemplate())}>
            <Download /> Download template
          </Button>
          <div className="space-y-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          {parsed && (
            <div className="rounded-md border p-3 text-sm">
              {parsed.errors.length === 0 ? (
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                  {fileName}: {parsed.products.length} product(s) ready to import.
                </p>
              ) : (
                <>
                  <p className="mb-2 flex items-center gap-2 font-medium text-destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                    {parsed.errors.length} problem(s) found. Fix them in the file and choose it again. Nothing has been imported.
                  </p>
                  <ScrollArea className="max-h-48">
                    <ul className="space-y-1 text-muted-foreground">
                      {parsed.errors.slice(0, 200).map((e, i) => (
                        <li key={i}>
                          {e.line > 0 && <span className="font-mono">Line {e.line}: </span>}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={!ok || busy}>
            <FileUp /> {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

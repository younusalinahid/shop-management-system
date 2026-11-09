'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { type CsvIssue, type ImportResult, type ParsedImport, parseProductCsv, productCsvTemplate } from '@/lib/product-csv'
import { translateMessage } from '@/i18n/translate'

/**
 * Two steps: pick a file and check it here (nothing sent yet), then POST it to /api/products/import,
 * which validates again and imports all new products in one transaction.
 */
export function ImportProductsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('import')
  const tAll = useTranslations()
  const [fileName, setFileName] = useState('')

  const issueText = (e: CsvIssue) =>
    e.key
      ? tAll(`csv.${e.key}`, { ...e.values, issue: e.issue ? translateMessage(tAll, e.issue.message, e.issue.values) : '' })
      : e.message
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [csv, setCsv] = useState('')
  const refresh = useRefreshData()
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    if (file.size > 5 * 1024 * 1024) {
      setParsed({ products: [], errors: [{ line: 0, message: 'File is larger than 5 MB.', key: 'fileTooLarge' }] })
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
        res.skipped.length && t('skipped', { count: res.skipped.length }),
        res.createdCategories && t('newCategories', { count: res.createdCategories }),
        res.createdBrands && t('newBrands', { count: res.createdBrands }),
      ].filter(Boolean)
      toast.success(t('imported', { count: res.created }), { description: extras.join(' · ') || undefined })
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
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={() => downloadText('product-import-template.csv', productCsvTemplate())}>
            <Download /> {t('downloadTemplate')}
          </Button>
          <div className="space-y-2">
            <Label htmlFor="csv-file">{t('csvFile')}</Label>
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          {parsed && (
            <div className="rounded-md border p-3 text-sm">
              {parsed.errors.length === 0 ? (
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                  {t('ready', { file: fileName, count: parsed.products.length })}
                </p>
              ) : (
                <>
                  <p className="mb-2 flex items-center gap-2 font-medium text-destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                    {t('problems', { count: parsed.errors.length })}
                  </p>
                  <ScrollArea className="max-h-48">
                    <ul className="space-y-1 text-muted-foreground">
                      {parsed.errors.slice(0, 200).map((e, i) => (
                        <li key={i}>
                          {e.line > 0 && <span className="font-mono">{t('line', { line: e.line })} </span>}
                          {issueText(e)}
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
            {t('cancel')}
          </Button>
          <Button onClick={() => void run()} disabled={!ok || busy}>
            <FileUp /> {busy ? t('importing') : t('import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { HardDrive, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes, getStorageStatus, requestPersistentStorage, type StorageStatus } from '@/services/storage-service'

export function StorageStatusCard() {
  const [status, setStatus] = useState<StorageStatus | null>(null)

  const refresh = () => getStorageStatus().then(setStatus)
  useEffect(() => {
    void refresh()
  }, [])

  const request = async () => {
    const ok = await requestPersistentStorage()
    await refresh()
    if (ok) toast.success('Persistent storage granted')
    else toast.warning('The browser did not grant persistent storage', { description: 'Installing the app usually helps. Keep exporting backups.' })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="size-4" aria-hidden /> Data on this device
        </CardTitle>
        <CardDescription>
          All shop data is stored in this browser only. Clearing browser data, uninstalling the browser or a device
          failure can erase it. Export a backup regularly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status && !status.supported && <p className="text-muted-foreground">This browser does not report storage status.</p>}
        {status?.supported && (
          <>
            <div className="flex items-center gap-2">
              {status.persisted ? (
                <>
                  <ShieldCheck className="size-4 text-success" aria-hidden />
                  <span>Persistent storage is on. The browser should not clear data automatically.</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4 text-warning" aria-hidden />
                  <span>Best-effort storage. The browser may clear data when the disk is low.</span>
                </>
              )}
            </div>
            <p className="text-muted-foreground">
              Using {formatBytes(status.usageBytes)} of {formatBytes(status.quotaBytes)} available.
            </p>
            {!status.persisted && (
              <Button size="sm" variant="outline" onClick={() => void request()}>
                Request persistent storage
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

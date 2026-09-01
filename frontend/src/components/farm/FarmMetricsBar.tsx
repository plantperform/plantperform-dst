import { useState } from 'react'
import { mutate } from 'swr'

import { farmKey } from '@/api/hooks'
import { updateFarm } from '@/api/mutations'
import type { Farm, FieldRecord } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  countFieldsWithoutQuota,
  formatNumber,
  getFieldTotals,
  getMarkQuotaSum,
} from '@/lib/farm-totals'

type MetricProps = {
  label: string
  value: string
  hint?: string
  action?: React.ReactNode
}

const Metric = ({ label, value, hint, action }: MetricProps) => (
  <div className="min-w-0">
    <div className="flex items-baseline gap-2">
      <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {action}
    </div>
    <p className="mt-1 truncate text-lg font-semibold">{value}</p>
    {hint ? (
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    ) : null}
  </div>
)

type FarmMetricsBarProps = {
  farm: Farm
  fields: FieldRecord[]
  onError: (message: string | null) => void
}

/**
 * Nøgletal for the visning currently selected in the sidebar. These numbers
 * describe the fields on screen, so they live with the fields rather than in
 * the sidebar, where they used to be shown for the bedrift as a whole and
 * repeated inside every navigation row.
 */
export const FarmMetricsBar = ({
  farm,
  fields,
  onError,
}: FarmMetricsBarProps) => {
  const totals = getFieldTotals(fields)
  const withinQuota = totals.nLoad <= farm.udledningskvoteKgN

  return (
    <div className="grid grid-cols-2 gap-4 border-b bg-muted/20 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Marker" value={String(fields.length)} />
      <Metric label="Areal" value={`${formatNumber(totals.area)} ha`} />
      <Metric label="DB2" value={`${formatNumber(totals.db2)} kr`} />
      <Metric
        label="Udledning"
        value={`${formatNumber(totals.nLoad)} kg N`}
        hint={withinQuota ? 'Inden for kvoten' : 'Over kvoten'}
      />
      <Metric
        label="Udvaskning"
        value={`${formatNumber(totals.leaching)} kg N`}
      />
      <Metric
        label="Udledningskvote"
        value={`${formatNumber(farm.udledningskvoteKgN)} kg N`}
        action={
          <QuotaDialog farm={farm} fields={fields} onError={onError} />
        }
      />
    </div>
  )
}

type QuotaDialogProps = {
  farm: Farm
  fields: FieldRecord[]
  onError: (message: string | null) => void
}

const QuotaDialog = ({ farm, fields, onError }: QuotaDialogProps) => {
  const [open, setOpen] = useState(false)
  const [quotaInput, setQuotaInput] = useState(String(farm.udledningskvoteKgN))
  const [isSaving, setIsSaving] = useState(false)
  const roundedQuotaSum = Math.round(getMarkQuotaSum(fields))
  const missingQuotaCount = countFieldsWithoutQuota(fields)

  const openChange = (next: boolean) => {
    setOpen(next)
    if (next) setQuotaInput(String(farm.udledningskvoteKgN))
  }

  const saveQuota = async () => {
    const quota = Number(quotaInput)
    if (!Number.isFinite(quota) || quota < 0) {
      onError('Udledningskvoten skal være et positivt tal eller nul.')
      return
    }

    setIsSaving(true)
    try {
      const updatedFarm = await updateFarm(farm.id, {
        udledningskvoteKgN: quota,
      })
      await mutate(farmKey(farm.id), updatedFarm, { revalidate: false })
      await mutate('/farms')
      setOpen(false)
      onError(null)
    } catch {
      onError('Kunne ikke opdatere kvælstofkvoten.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Rediger
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rediger udledningskvote</DialogTitle>
          <DialogDescription>
            Justér bedriftens samlede udledningskvote, eller beregn den ud fra
            summen af markernes kvoter.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="farm-quota">Udledningskvote (kg N)</Label>
            <Input
              id="farm-quota"
              type="number"
              min="0"
              step="0.1"
              value={quotaInput}
              onChange={(event) => setQuotaInput(event.target.value)}
            />
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              Sum af markernes kvoter: {formatNumber(roundedQuotaSum)} kg N
            </p>
            {missingQuotaCount > 0 ? (
              <p className="text-amber-700">
                {missingQuotaCount}{' '}
                {missingQuotaCount === 1 ? 'mark' : 'marker'} uden data for
                udledningsgrænse indgår som 0 kg N. Summen kan derfor være for
                lav.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuller</Button>
          </DialogClose>
          <Button
            variant="outline"
            onClick={() => setQuotaInput(String(roundedQuotaSum))}
            disabled={fields.length === 0}
          >
            Brug sum fra marker
          </Button>
          <Button onClick={() => void saveQuota()} disabled={isSaving}>
            {isSaving ? 'Gemmer...' : 'Gem'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

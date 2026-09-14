import { Lock, LockOpen, Pencil, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import type { FieldRecord } from '@/api/types'
import { CropYearSwatch } from '@/components/farm/CropYearSwatch'
import { Button } from '@/components/ui/button'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cropGroupColor } from '@/lib/crop-groups'
import {
  formatNumber,
  isFieldLocked,
  ROTATION_START_CALENDAR_YEAR,
} from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type MapRuleCardProps = {
  field: FieldRecord
  locking: boolean
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
  rotationOpen: boolean
  onRotationOpenChange: (open: boolean) => void
  onClose: () => void
}

const ActionTooltip = ({
  text,
  children,
}: {
  text: string
  children: ReactNode
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="flex">{children}</span>
    </TooltipTrigger>
    <TooltipContent side="bottom" sideOffset={6} className="max-w-56">
      {text}
    </TooltipContent>
  </Tooltip>
)

export const MapRuleCard = ({
  field,
  locking,
  onToggleLock,
  onBindRotation,
  rotationOpen,
  onRotationOpenChange,
  onClose,
}: MapRuleCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const stop = (event: Event) => event.stopPropagation()
    card.addEventListener('dblclick', stop)
    return () => card.removeEventListener('dblclick', stop)
  }, [])

  const years = field.cropRotation.map((year, index) => ({
    year,
    calendarYear: ROTATION_START_CALENDAR_YEAR + index,
    color: cropGroupColor(year.afgrodeKode, year.afgrodeNavn),
  }))
  const noRotation = field.rotationId === null
  const locked = isFieldLocked(field)
  const editTooltip = noRotation
    ? 'Kør Optimér for denne mark, før du kan vælge et sædskifte.'
    : 'Vælg et bestemt sædskifte og lås marken til det.'
  const lockTooltip = noRotation
    ? 'Kør Optimér for denne mark, før du kan låse et sædskifte.'
    : locked
      ? 'Lås marken op, så Optimér igen kan ændre sædskiftet.'
      : 'Lås marken til det nuværende sædskifte.'

  return (
    <div
      ref={cardRef}
      data-map-overlay
      className="w-64 max-w-[calc(100vw-2rem)] rounded-lg border bg-card text-xs text-card-foreground shadow-lg motion-safe:animate-[rise-in_180ms_ease-out_both]"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="min-w-0 truncate text-sm font-semibold">
          {field.name}
        </span>
        {locked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
            <Lock className="size-3" aria-hidden="true" />
            Låst
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
            <LockOpen className="size-3" aria-hidden="true" />
            Fri
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {formatNumber(field.areaHa)} ha
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="-mr-1.5 size-6 shrink-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Luk"
          title="Luk"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="border-t">
        {noRotation || years.length === 0 ? (
          <p className="px-3 py-2 text-muted-foreground">
            Intet sædskifte endnu - kør Optimér for denne mark
          </p>
        ) : (
          <>
            <DisclosureButton
              open={rotationOpen}
              onToggle={() => onRotationOpenChange(!rotationOpen)}
              label={locked ? 'Låst til sædskifte' : 'Nuværende sædskifte'}
              aria-controls="map-rule-card-rotation"
              hint={
                <span className="flex gap-0.5">
                  {years.map(({ year, calendarYear, color }) => (
                    <CropYearSwatch
                      key={calendarYear}
                      color={color}
                      hasUdlaeg={year.udlaegNavn !== null}
                      size="10x8"
                    />
                  ))}
                </span>
              }
              hintAlign="end"
              className="w-full px-3 py-2"
            />
            {rotationOpen ? (
              <div id="map-rule-card-rotation" className="px-3 pb-2">
                <ul className="space-y-1">
                  {years.map(({ year, calendarYear, color }) => (
                    <li key={calendarYear} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                        {calendarYear}
                      </span>
                      <CropYearSwatch
                        color={color}
                        hasUdlaeg={year.udlaegNavn !== null}
                        size="14x10"
                      />
                      <span className="min-w-0 truncate">
                        {year.afgrodeNavn}
                        {year.udlaegNavn ? (
                          <span className="text-muted-foreground">
                            {` (udlæg: ${year.udlaegNavn})`}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-muted-foreground">
                  {locked ? 'Optimér ændrer det ikke' : 'Optimér kan ændre det'}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <TooltipProvider delayDuration={200}>
        <div className="grid grid-cols-2 gap-2 border-t p-2">
          <ActionTooltip text={editTooltip}>
            <Button
              variant="outline"
              size="xs"
              className="w-full gap-1.5 px-2"
              disabled={noRotation}
              onClick={() => onBindRotation(field)}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Vælg sædskifte
            </Button>
          </ActionTooltip>
          <ActionTooltip text={lockTooltip}>
            <Button
              variant="outline"
              size="xs"
              className={cn(
                'w-full gap-1.5 px-2',
                locked &&
                  'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900',
              )}
              disabled={noRotation || locking}
              onClick={() => onToggleLock(field)}
            >
              {locked ? (
                <LockOpen className="size-3.5" aria-hidden="true" />
              ) : (
                <Lock className="size-3.5" aria-hidden="true" />
              )}
              {locked ? 'Lås op' : 'Lås'}
            </Button>
          </ActionTooltip>
        </div>
      </TooltipProvider>
    </div>
  )
}

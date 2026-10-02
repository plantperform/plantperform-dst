import { Lock, LockOpen, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import type { FieldRecord } from '@/api/types'
import {
  DEFAULT_FIELDS_SORT,
  type FieldsSortKey,
  type FieldsSortState,
} from '@/components/farm/field-list-state'
import {
  CollapseButton,
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
} from '@/components/farm/rules-ui'
import { SortHeaderButton } from '@/components/farm/SortableColumnHeaderContent'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  formatNumber,
  isFieldLocked,
  ROTATION_CALENDAR_YEARS,
} from '@/lib/field-domain'
import { compareFields } from '@/lib/field-sort'
import { cn } from '@/lib/utils'

const ROW_GRID_CLASS =
  'grid grid-cols-[120px_84px_minmax(240px,1fr)_136px_232px] items-center gap-3 px-5'

const NO_ROTATION_TITLE =
  'Kør Optimér for denne mark, før du kan binde et sædskifte.'

const rotationByYear = (field: FieldRecord) =>
  field.cropRotation.length === 0
    ? []
    : ROTATION_CALENDAR_YEARS.map((year, index) => ({
        year,
        cropName:
          field.cropRotation[index % field.cropRotation.length].cropName,
      }))

type FieldRuleRowProps = {
  field: FieldRecord
  hovered: boolean
  locking: boolean
  actionsDisabled: boolean
  registerRow: (fieldId: string, element: HTMLDivElement | null) => void
  onHoveredFieldChange: (fieldId: string | null) => void
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

const FieldRuleRow = ({
  field,
  hovered,
  locking,
  actionsDisabled,
  registerRow,
  onHoveredFieldChange,
  onToggleLock,
  onBindRotation,
}: FieldRuleRowProps) => {
  const locked = isFieldLocked(field)
  const noRotation = field.rotationId === null
  const years = rotationByYear(field)
  const actionClass = 'h-7.5 px-2 text-xs font-semibold text-muted-foreground'
  return (
    <div
      ref={(element) => registerRow(field.id, element)}
      tabIndex={-1}
      className={cn(
        ROW_GRID_CLASS,
        'border-b text-[13px] focus:ring-2 focus:ring-ring focus:outline-none focus:ring-inset',
        locked
          ? cn('py-2', hovered ? 'bg-rules/10' : 'bg-rules/5')
          : cn('py-1.5', hovered ? 'bg-muted/40' : 'bg-card'),
      )}
      onMouseEnter={() => onHoveredFieldChange(field.id)}
      onMouseLeave={() => onHoveredFieldChange(null)}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{field.name}</span>
        <span className="block text-xs text-muted-foreground">
          {formatNumber(field.areaHa)} ha
        </span>
      </span>
      {locked ? (
        <span className="inline-flex items-center gap-1.5 font-semibold text-rules">
          <Lock className="size-3.5" aria-hidden="true" />
          Låst
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <LockOpen className="size-3.5" aria-hidden="true" />
          Fri
        </span>
      )}
      {locked && years.length > 0 ? (
        <AppTooltip
          content={years
            .map(({ year, cropName }) => `${year}: ${cropName}`)
            .join(', ')}
        >
          <span className="min-w-0 text-xs">
            {years.map(({ cropName }) => cropName).join(' · ')}
          </span>
        </AppTooltip>
      ) : (
        <span className="text-muted-foreground">Optimeringen vælger</span>
      )}
      {field.allowedRotationIds.length === 0 ? (
        <span className="text-muted-foreground">Alle i simuleringen</span>
      ) : (
        <span>{field.allowedRotationIds.length} valgt</span>
      )}
      <span
        className={cn(
          'flex justify-end gap-0.5',
          actionsDisabled && 'pointer-events-none opacity-50',
        )}
      >
        <AppTooltip content={noRotation ? NO_ROTATION_TITLE : undefined}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              className={actionClass}
              disabled={noRotation || actionsDisabled}
              onClick={() => onBindRotation(field)}
            >
              Vælg og lås sædskifte…
            </Button>
          </span>
        </AppTooltip>
        <AppTooltip content={noRotation ? NO_ROTATION_TITLE : undefined}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              className={cn(
                actionClass,
                'gap-1.5',
                locked && 'text-rules hover:bg-rules/10 hover:text-rules',
              )}
              disabled={noRotation || actionsDisabled}
              loading={locking}
              aria-label={`${locked ? 'Lås op' : 'Lås'} ${field.name}`}
              onClick={() => onToggleLock(field)}
            >
              {locked || locking ? null : (
                <Lock className="size-3" aria-hidden="true" />
              )}
              {locked ? 'Lås op' : 'Lås'}
            </Button>
          </span>
        </AppTooltip>
      </span>
    </div>
  )
}

type FieldRulesCardProps = {
  fields: FieldRecord[]
  lockingFieldId: string | null
  hoveredFieldId: string | null
  focusRequest?: { fieldId: string; nonce: number }
  onHoveredFieldChange: (fieldId: string | null) => void
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

export const FieldRulesCard = ({
  fields,
  lockingFieldId,
  hoveredFieldId,
  focusRequest,
  onHoveredFieldChange,
  onToggleLock,
  onBindRotation,
}: FieldRulesCardProps) => {
  const id = useId()
  const [expanded, setExpanded] = useState(true)
  const [seenFocusNonce, setSeenFocusNonce] = useState(
    focusRequest?.nonce ?? null,
  )
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FieldsSortState>(DEFAULT_FIELDS_SORT)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const focusedNonce = useRef(focusRequest?.nonce ?? null)

  if (focusRequest && focusRequest.nonce !== seenFocusNonce) {
    setSeenFocusNonce(focusRequest.nonce)
    setExpanded(true)
  }

  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === focusedNonce.current) return
    focusedNonce.current = focusRequest.nonce
    const row = rowElements.current.get(focusRequest.fieldId)
    if (!row) return
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [focusRequest])

  const registerRow = (fieldId: string, element: HTMLDivElement | null) => {
    if (element) rowElements.current.set(fieldId, element)
    else rowElements.current.delete(fieldId)
  }

  const hasRun = fields.some((field) => field.rotationId !== null)
  const normalizedQuery = query.trim().toLowerCase()
  const shown = fields
    .filter((field) => field.name.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => compareFields(left, right, sort))
  const lockedFields = shown.filter(isFieldLocked)
  const freeFields = shown.filter((field) => !isFieldLocked(field))
  const lockedCount = fields.filter(isFieldLocked).length

  const sortHeader = (label: string, key: FieldsSortKey) => {
    const active = sort.key === key
    return (
      <SortHeaderButton
        label={label}
        sorted={active ? sort.direction : false}
        onToggle={() =>
          setSort({
            key,
            direction: active && sort.direction === 'asc' ? 'desc' : 'asc',
          })
        }
      />
    )
  }

  const renderRow = (field: FieldRecord) => (
    <FieldRuleRow
      key={field.id}
      field={field}
      hovered={hoveredFieldId === field.id}
      locking={lockingFieldId === field.id}
      actionsDisabled={!hasRun}
      registerRow={registerRow}
      onHoveredFieldChange={onHoveredFieldChange}
      onToggleLock={onToggleLock}
      onBindRotation={onBindRotation}
    />
  )

  const groupHeadingClass =
    'flex items-center gap-1.5 border-b px-5 pt-2 pb-1 text-xs font-semibold'

  return (
    <section
      className={cn(RULES_CARD_CLASS, 'overflow-hidden')}
      aria-labelledby={`${id}-title`}
    >
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Regler pr. mark
          </h3>
          {hasRun ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Låste marker beholder deres sædskifte; frie marker må optimeringen
              ændre. Låsning gemmes med det samme.
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-amber-800">
              Marker kan låses, når Optimér har kørt for simuleringen.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {expanded ? (
            <div className="relative w-55">
              <label htmlFor={`${id}-search`} className="sr-only">
                Find mark
              </label>
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id={`${id}-search`}
                type="search"
                value={query}
                placeholder="Find mark…"
                className="h-9 pl-8"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
          <CollapseButton
            expanded={expanded}
            controls={`${id}-fields`}
            onExpandedChange={setExpanded}
          />
        </div>
      </div>

      {expanded ? (
        <div id={`${id}-fields`} className="overflow-x-auto">
          <div className="min-w-225">
            <div
              className={cn(
                ROW_GRID_CLASS,
                'border-y bg-muted/30 py-2 text-xs font-semibold text-muted-foreground',
              )}
            >
              <span className="flex gap-2.5">
                {sortHeader('Mark', 'name')}
                {sortHeader('Areal', 'areaHa')}
              </span>
              <span>Status</span>
              <span>Bundet sædskifte</span>
              <span>Tilladte sædskifter</span>
              <span className="text-right">Handlinger</span>
            </div>

            {shown.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted-foreground">
                Ingen marker matcher "{query.trim()}".
              </p>
            ) : (
              <>
                {lockedFields.length > 0 ? (
                  <>
                    <h4
                      className={cn(groupHeadingClass, 'bg-rules/5 text-rules')}
                    >
                      <Lock className="size-3" aria-hidden="true" />
                      Låste marker · {lockedFields.length}
                    </h4>
                    {lockedFields.map(renderRow)}
                  </>
                ) : null}
                {freeFields.length > 0 ? (
                  <>
                    <h4
                      className={cn(groupHeadingClass, 'text-muted-foreground')}
                    >
                      <LockOpen className="size-3" aria-hidden="true" />
                      Frie marker · {freeFields.length}
                    </h4>
                    {freeFields.map(renderRow)}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      <p
        className={cn(
          'bg-muted/30 px-5 py-2.5 text-[13px] font-semibold',
          !expanded && 'border-t',
        )}
      >
        {lockedCount} af {fields.length} marker låst
      </p>
    </section>
  )
}

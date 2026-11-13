import { ChevronRight, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCropCodes, useUndersownCropCodes } from '@/api/hooks'
import { useOwnRotationDefinitions } from '@/api/own-rotations'
import type { RotationDefinition, RotationYear } from '@/api/types'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { FARM_LIST_CLASS } from '@/components/farm/FarmList'
import { FarmSearchInput } from '@/components/farm/FarmSearchInput'
import { LibraryRotationCopyDialog } from '@/components/farm/LibraryRotationCopyDialog'
import {
  NEW_OWN_ROTATION_ID,
  ownRotationPath,
  useOwnRotationActions,
} from '@/components/farm/own-rotations-state'
import { OwnRotationsShareDialog } from '@/components/farm/OwnRotationsShareDialog'
import { AppTooltip } from '@/components/ui/app-tooltip'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Pending } from '@/components/ui/pending'
import { cropGroupFor } from '@/lib/crop-groups'
import { formatCount } from '@/lib/economics'
import {
  DELETE_ROTATION_DIALOG,
  MAX_ROTATION_YEARS,
  definitionYears,
  describeRotationYear,
  describeYearCount,
} from '@/lib/own-rotations'
import { cn } from '@/lib/utils'
import { MEASURE_COVERS, measureCover } from '@/lib/winter-cover'

const FULL_GRID_CLASS =
  'grid grid-cols-[32px_180px_minmax(0,1fr)_32px] items-center gap-x-3 px-4 @min-[1100px]:grid-cols-[32px_230px_minmax(0,1fr)_32px]'

const COMPACT_GRID_CLASS =
  'grid grid-cols-[28px_170px_92px_28px_56px_minmax(0,1fr)_28px] items-center gap-x-2.5 px-4'

const HEADER_CLASS = 'py-2.5 text-xs font-medium text-muted-foreground'

const NAME_LINK_CLASS =
  'block truncate rounded-sm font-display after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const CHEVRON_CLASS =
  'size-4 justify-self-end text-muted-foreground transition-colors group-hover:text-foreground'

const rowClass = (selected: boolean) =>
  cn(
    'group relative transition-colors',
    selected ? 'bg-primary/5' : 'hover:bg-muted/40',
  )

const coverColor = ({ undersownCropCode }: RotationYear): string =>
  undersownCropCode === null
    ? 'transparent'
    : (measureCover(undersownCropCode)?.color ?? 'transparent')

type SelectBoxProps = {
  label: string
  checked: boolean
  indeterminate?: boolean
  compact?: boolean
  onChange: (checked: boolean) => void
}

const SelectBox = ({
  label,
  checked,
  indeterminate = false,
  compact = false,
  onChange,
}: SelectBoxProps) => (
  <label
    className={cn(
      'relative z-10 flex cursor-pointer items-center justify-center',
      compact ? 'size-7' : 'size-8',
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate
      }}
      className="size-4 cursor-pointer accent-primary"
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
)

type OwnRotationRowProps = {
  path: string
  definition: RotationDefinition
  years: RotationYear[]
  selected: boolean
  onSelect: (selected: boolean) => void
}

const OwnRotationRow = ({
  path,
  definition,
  years,
  columns,
  selected,
  onSelect,
}: OwnRotationRowProps & { columns: number }) => {
  const meta = [
    definition.farmingSystem ?? 'Uden driftsform',
    describeYearCount(years.length),
    definition.variants.length > 1
      ? `${definition.variants.length} udgaver`
      : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <li className={cn(FULL_GRID_CLASS, rowClass(selected), 'py-3.5')}>
      <SelectBox
        label={`Vælg ${definition.name}`}
        checked={selected}
        onChange={onSelect}
      />
      <div className="min-w-0">
        <Link
          to={path}
          title={definition.name}
          className={cn(NAME_LINK_CLASS, 'text-xl leading-tight')}
        >
          {definition.name}
        </Link>
        <p className="mt-0.5 truncate text-[12.5px] leading-snug text-muted-foreground">
          {meta}
        </p>
      </div>
      <Link to={path} tabIndex={-1} className="relative z-10 min-w-0">
        <ol
          className="grid items-start gap-x-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {years.map((year, index) => (
            <AppTooltip key={index} content={describeRotationYear(year, index)}>
              <li className="grid min-w-0 grid-cols-[auto_18px_minmax(0,1fr)] items-center gap-x-1.5">
                <span className="text-xs leading-[18px] text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <CropGroupTile
                  group={cropGroupFor(year.cropCode, year.cropName)}
                />
                <span className="truncate pr-1 text-[13px] leading-[18px] font-medium">
                  {year.cropName}
                </span>
                <span />
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-0.5 self-start"
                  style={{ backgroundColor: coverColor(year) }}
                />
                <span className="mt-0.5 min-h-4 truncate text-xs leading-4 text-muted-foreground">
                  {year.undersownCropName}
                </span>
              </li>
            </AppTooltip>
          ))}
        </ol>
      </Link>
      <ChevronRight className={CHEVRON_CLASS} aria-hidden="true" />
    </li>
  )
}

const OwnRotationCompactRow = ({
  path,
  definition,
  years,
  selected,
  onSelect,
}: OwnRotationRowProps) => (
  <li className={cn(COMPACT_GRID_CLASS, rowClass(selected), 'py-2.5')}>
    <SelectBox
      compact
      label={`Vælg ${definition.name}`}
      checked={selected}
      onChange={onSelect}
    />
    <Link
      to={path}
      title={definition.name}
      className={cn(NAME_LINK_CLASS, 'text-[17px] leading-snug')}
    >
      {definition.name}
    </Link>
    <span className="truncate text-[13px] leading-snug">
      {definition.farmingSystem ?? 'Uden driftsform'}
    </span>
    <span className="text-[13px] leading-snug tabular-nums">
      {years.length}
    </span>
    <span className="text-[13px] leading-snug tabular-nums">
      {definition.variants.length > 1 ? definition.variants.length : '-'}
    </span>
    <Link to={path} tabIndex={-1} className="relative z-10 min-w-0">
      <ol className="grid grid-cols-8 gap-1.5">
        {years.map((year, index) => (
          <AppTooltip key={index} content={describeRotationYear(year, index)}>
            <li
              className="flex h-6 min-w-0 items-center gap-1 border-b-2"
              style={{ borderBottomColor: coverColor(year) }}
            >
              <CropGroupTile
                className="size-4"
                group={cropGroupFor(year.cropCode, year.cropName)}
              />
              <span className="truncate text-[11px] leading-4 font-medium text-muted-foreground tabular-nums">
                {year.cropCode}
              </span>
            </li>
          </AppTooltip>
        ))}
      </ol>
    </Link>
    <ChevronRight className={CHEVRON_CLASS} aria-hidden="true" />
  </li>
)

type OwnRotationsOverviewProps = {
  farmId: string
  farmName: string
}

export const OwnRotationsOverview = ({
  farmId,
  farmName,
}: OwnRotationsOverviewProps) => {
  const definitions = useOwnRotationDefinitions()
  const crops = useCropCodes(farmId)
  const undersown = useUndersownCropCodes(farmId)
  const actions = useOwnRotationActions(farmId)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sharingSelected, setSharingSelected] = useState(false)
  const [deletingSelected, setDeletingSelected] = useState(false)
  const cropNames = new Map(
    (crops.data ?? []).map((crop) => [crop.code, crop.name]),
  )
  const undersownNames = new Map(
    (undersown.data ?? []).map((option) => [option.code, option.name]),
  )
  const own = (definitions.data ?? [])
    .toSorted((left, right) => left.name.localeCompare(right.name, 'da'))
    .map((definition) => ({
      definition,
      years: definitionYears(definition, cropNames, undersownNames),
    }))
  const search = query.trim().toLocaleLowerCase('da')
  const shown = own.filter(
    ({ definition, years }) =>
      search === '' ||
      [definition.name, ...years.map((year) => year.cropName)]
        .join(' ')
        .toLocaleLowerCase('da')
        .includes(search),
  )
  const selected = own
    .map(({ definition }) => definition)
    .filter((definition) => selectedIds.includes(definition.id))
  const shownSelectedCount = shown.filter(({ definition }) =>
    selectedIds.includes(definition.id),
  ).length
  const allShownSelected =
    shown.length > 0 && shownSelectedCount === shown.length
  const one = selected.length === 1 ? selected[0] : null
  const columns = Math.max(1, ...own.map(({ years }) => years.length))

  const select = (ids: string[], checked: boolean) =>
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    )

  const selectAll = (compact: boolean) => (
    <SelectBox
      compact={compact}
      label="Vælg alle viste sædskifter"
      checked={allShownSelected}
      indeterminate={shownSelectedCount > 0 && !allShownSelected}
      onChange={(checked) =>
        select(
          shown.map(({ definition }) => definition.id),
          checked,
        )
      }
    />
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto flex max-w-[96rem] flex-col gap-5 px-6 pt-9 pb-15 sm:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-4xl tracking-tight">
              Egne sædskifter
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              <b className="font-semibold text-foreground">{farmName}</b>. Byg
              dine egne sædskifter af afgrøderne i bibliotekets sædskifter. Du
              kan vælge dem i Ny simulering på alle dine bedrifter.
            </p>
          </div>
          {definitions.data && crops.data ? (
            <div className="flex flex-wrap items-center gap-2">
              <LibraryRotationCopyDialog
                cropNames={cropNames}
                copyingId={actions.copyingId}
                onCopy={actions.copy}
              />
              {own.length > 0 ? (
                <Button asChild>
                  <Link to={ownRotationPath(farmId, NEW_OWN_ROTATION_ID)}>
                    <Plus aria-hidden="true" />
                    Nyt sædskifte
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>
        {definitions.data && crops.data && undersown.data ? (
          own.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-11 text-center">
              <h2 className="text-[17px] font-semibold">
                Ingen egne sædskifter endnu
              </h2>
              <p className="max-w-[460px] text-sm text-muted-foreground">
                Byg et sædskifte år for år, og vælg et virkemiddel til hver
                afgrøde. Du kan også kopiere et fra biblioteket og rette i det.
              </p>
              <Button asChild>
                <Link to={ownRotationPath(farmId, NEW_OWN_ROTATION_ID)}>
                  Byg et sædskifte
                </Link>
              </Button>
            </Card>
          ) : (
            <div className="mt-1.5 flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <FarmSearchInput
                  className="w-72 max-w-full"
                  value={query}
                  onChange={setQuery}
                  placeholder="Søg på navn eller afgrøde"
                  label="Søg i egne sædskifter"
                />
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={cn(
                      'text-[13px]',
                      selected.length > 0
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {selected.length > 0
                      ? `${selected.length} valgt`
                      : 'Sæt flueben for at dele eller slette'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selected.length === 0}
                    onClick={() => setSharingSelected(true)}
                  >
                    <UserPlus aria-hidden="true" />
                    Del
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selected.length === 0}
                    onClick={() => setDeletingSelected(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Slet
                  </Button>
                </div>
              </div>
              {shown.length === 0 ? (
                <Card className="px-6 py-14 text-center">
                  <p className="font-display text-xl leading-snug">
                    Ingen sædskifter matcher "{query.trim()}"
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    Søgningen rammer både sædskiftets navn og afgrøderne i det.
                    Prøv et andet ord, eller ryd søgningen for at se alle{' '}
                    {formatCount(own.length, 'sædskifte', 'sædskifter')}.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setQuery('')}
                  >
                    <X aria-hidden="true" />
                    Ryd søgning
                  </Button>
                </Card>
              ) : (
                <>
                  <div
                    className={cn(
                      FARM_LIST_CLASS,
                      'hidden @min-[1000px]:block',
                    )}
                  >
                    <div className={cn(FULL_GRID_CLASS, HEADER_CLASS)}>
                      {selectAll(false)}
                      <span>Sædskifte</span>
                      <span>Afgrøder år for år</span>
                      <span />
                    </div>
                    <ul className="divide-y">
                      {shown.map(({ definition, years }) => (
                        <OwnRotationRow
                          key={definition.id}
                          path={ownRotationPath(farmId, definition.id)}
                          definition={definition}
                          years={years}
                          columns={columns}
                          selected={selectedIds.includes(definition.id)}
                          onSelect={(checked) =>
                            select([definition.id], checked)
                          }
                        />
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2.5 @min-[1000px]:hidden">
                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 text-xs leading-snug text-muted-foreground">
                      <span>Streg under året = vinterdække/virkemiddel</span>
                      {MEASURE_COVERS.map((cover) => (
                        <span
                          key={cover.id}
                          className="inline-flex items-center gap-1.5"
                        >
                          <span
                            aria-hidden="true"
                            className="h-0.5 w-3.5"
                            style={{ backgroundColor: cover.color }}
                          />
                          {cover.label}
                        </span>
                      ))}
                    </div>
                    <div className={FARM_LIST_CLASS}>
                      <div className={cn(COMPACT_GRID_CLASS, HEADER_CLASS)}>
                        {selectAll(true)}
                        <span>Sædskifte</span>
                        <span>Driftsform</span>
                        <span>År</span>
                        <span>Udgaver</span>
                        <span className="grid grid-cols-8 gap-1.5">
                          {Array.from(
                            { length: MAX_ROTATION_YEARS },
                            (_, index) => (
                              <span key={index}>{index + 1}.</span>
                            ),
                          )}
                        </span>
                        <span />
                      </div>
                      <ul className="divide-y">
                        {shown.map(({ definition, years }) => (
                          <OwnRotationCompactRow
                            key={definition.id}
                            path={ownRotationPath(farmId, definition.id)}
                            definition={definition}
                            years={years}
                            selected={selectedIds.includes(definition.id)}
                            onSelect={(checked) =>
                              select([definition.id], checked)
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        ) : (
          <Pending
            failed={Boolean(
              definitions.error || crops.error || undersown.error,
            )}
            failure="Sædskifterne kunne ikke hentes."
            loading="Henter sædskifterne..."
            retrying={
              definitions.isValidating ||
              crops.isValidating ||
              undersown.isValidating
            }
            onRetry={() => {
              void definitions.mutate()
              void crops.mutate()
              void undersown.mutate()
            }}
          />
        )}
      </div>
      <OwnRotationsShareDialog
        definitions={selected}
        open={sharingSelected}
        onOpenChange={setSharingSelected}
        onShared={() => setSharingSelected(false)}
      />
      <ConfirmDialog
        name={deletingSelected && selected.length > 0 ? 'valgte' : null}
        title={
          one
            ? `Slet ${one.name}?`
            : `Slet ${formatCount(selected.length, 'sædskifte', 'sædskifter')}?`
        }
        description={
          one
            ? DELETE_ROTATION_DIALOG.description
            : 'Sædskifterne slettes for alle, de er delt med, og fjernes fra de simuleringer, hvor de er valgt. Deres resultater bliver forældede.'
        }
        confirmLabel={one ? 'Slet sædskifte' : 'Slet sædskifter'}
        onOpenChange={setDeletingSelected}
        onConfirm={() => void actions.removeAll(selected)}
      >
        {one ? null : (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {selected.map((definition) => (
              <li key={definition.id} className="truncate">
                {definition.name}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  )
}

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Ellipsis,
  GripVertical,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'

import { useUndersownCropCodes } from '@/api/hooks'
import type { CropCodeOption, FarmingSystem } from '@/api/types'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { SearchableCropPickerList } from '@/components/farm/SearchableCropPickerList'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Pending } from '@/components/ui/pending'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CHOICE_SELECTED_CLASS } from '@/components/farm/choice-styles'
import { cropGroupColor, cropGroupFor } from '@/lib/crop-groups'
import { cropLabel } from '@/lib/crop-label'
import {
  describeUndersownFit,
  type OwnRotationYear,
  type YearStatus,
} from '@/lib/own-rotations'
import { cn } from '@/lib/utils'

type CropPickerProps = {
  label: string
  cropCode: number | null
  cropName: string
  cropOptions: CropCodeOption[]
  onChange: (cropCode: number) => void
}

const CropPicker = ({
  label,
  cropCode,
  cropName,
  cropOptions,
  onChange,
}: CropPickerProps) => {
  const [open, setOpen] = useState(false)
  const items = cropOptions.map((option) => ({
    key: String(option.code),
    label: cropLabel(option.code, option.name),
    title: cropLabel(option.code, option.name),
    colors: [cropGroupColor(option.code, option.name)],
  }))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Afgrøde i ${label}: ${cropCode === null ? 'ikke valgt' : cropName}`}
          className={cn(
            'flex h-10 w-full shrink-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-55',
            cropCode === null
              ? 'border-primary bg-card font-semibold text-primary hover:bg-primary/5'
              : 'border-input bg-background hover:bg-muted',
          )}
        >
          {cropCode === null ? (
            <span className="flex-1">Vælg afgrøde</span>
          ) : (
            <>
              <CropGroupTile group={cropGroupFor(cropCode, cropName)} />
              <span className="min-w-0 flex-1 truncate">{cropName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {cropCode}
              </span>
            </>
          )}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <SearchableCropPickerList
          items={items}
          selectedKey={cropCode === null ? null : String(cropCode)}
          onSelect={(key) => {
            onChange(Number(key))
            setOpen(false)
          }}
          searchLabel="Søg afgrøde"
          searchPlaceholder="Søg afgrøde..."
          emptyMessage="Ingen afgrøder matcher søgningen"
        />
      </PopoverContent>
    </Popover>
  )
}

type UndersownOption = { code: number; name: string; unfit: boolean }

type UndersownPickerProps = {
  label: string
  cropName: string
  nextCropName: string | null
  farmingSystem: FarmingSystem | null
  offeredCount: number | null
  options: UndersownOption[]
  selected: number[]
  failed: boolean
  retrying: boolean
  onRetry: () => void
  onSelect: (code: number | null) => void
  onClose: () => void
}

const UndersownPicker = ({
  label,
  cropName,
  nextCropName,
  farmingSystem,
  offeredCount,
  options,
  selected,
  failed,
  retrying,
  onRetry,
  onSelect,
  onClose,
}: UndersownPickerProps) => {
  const [query, setQuery] = useState('')
  const groupName = useId()
  const search = query.trim().toLocaleLowerCase('da')
  const shown = options.filter(
    (option) =>
      search === '' || option.name.toLocaleLowerCase('da').includes(search),
  )
  const choices: { code: number | null; name: string; unfit: boolean }[] = [
    { code: null, name: 'Intet virkemiddel', unfit: false },
    ...shown,
  ]

  return (
    <div className="flex max-h-110 flex-col gap-2.5 px-4 pt-3.5 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            Virkemiddel i {label}, {cropName}
          </p>
          {offeredCount !== null ? (
            <p className="text-xs text-muted-foreground">
              {describeUndersownFit(
                offeredCount,
                cropName,
                nextCropName,
                farmingSystem,
              )}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="xs" onClick={onClose}>
          Luk
        </Button>
      </div>
      {offeredCount === null ? (
        <Pending
          failed={failed}
          failure="Virkemidlerne kunne ikke hentes."
          loading="Henter virkemidlerne..."
          retrying={retrying}
          onRetry={onRetry}
        />
      ) : (
        <>
          <Input
            type="search"
            aria-label="Søg virkemiddel"
            placeholder="Søg virkemiddel"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 && search !== '' ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Ingen virkemidler matcher søgningen.
              </p>
            ) : (
              <ul className="gap-6 sm:columns-2">
                {choices.map((option) => (
                  <li
                    key={option.code ?? 'none'}
                    className="break-inside-avoid"
                  >
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                      <input
                        type="radio"
                        name={groupName}
                        className="size-4 shrink-0 accent-primary"
                        checked={
                          option.code === null
                            ? selected.length === 0
                            : selected.includes(option.code)
                        }
                        onChange={() => onSelect(option.code)}
                      />
                      <span className="min-w-0 truncate" title={option.name}>
                        {option.name}
                      </span>
                      {option.unfit ? (
                        <span className="shrink-0 text-destructive">
                          passer ikke længere
                        </span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

type OwnRotationYearViewProps = {
  number: number
  cropCode: number | null
  cropName: string | null
  undersownName: string | null
}

export const OwnRotationYearView = ({
  number,
  cropCode,
  cropName,
  undersownName,
}: OwnRotationYearViewProps) => {
  const name = cropName ?? `Afgrøde ${cropCode}`
  return (
    <li className="flex flex-wrap items-center gap-x-3 border-t px-4 py-2 sm:flex-nowrap">
      <span className="w-13 shrink-0 pl-5 text-sm text-muted-foreground tabular-nums">
        {number}.
      </span>
      <span className="flex h-10 w-full shrink-0 items-center gap-2 px-2.5 text-sm sm:w-55">
        {cropCode === null ? null : (
          <CropGroupTile group={cropGroupFor(cropCode, name)} />
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cropCode}
        </span>
      </span>
      <span
        title={undersownName ?? undefined}
        className="min-w-0 flex-1 basis-64 truncate text-[13px]"
      >
        {undersownName}
      </span>
    </li>
  )
}

export const OwnRotationYearHeader = ({ editing }: { editing: boolean }) => (
  <div className="hidden items-center gap-x-3 border-t px-4 py-2 text-xs text-muted-foreground sm:flex">
    <span className="w-13 shrink-0 pl-5">År</span>
    <span
      className={cn(
        'flex w-55 shrink-0 gap-2 pl-2.5',
        editing ? 'pr-8.75' : 'pr-2.5',
      )}
    >
      <span className="flex-1">Afgrøde</span>
      <span>Kode</span>
    </span>
    <span className="min-w-0 flex-1">Vinterdække/virkemiddel</span>
  </div>
)

const STATUS_LABEL: Record<YearStatus, string | null> = {
  saved: null,
  changed: 'Ændret',
  new: 'Nyt',
}

type OwnRotationYearRowProps = {
  farmId: string
  number: number
  year: OwnRotationYear
  cropName: string | null
  nextCropCode: number | null
  nextCropName: string | null
  cropOptions: CropCodeOption[]
  farmingSystem: FarmingSystem | null
  undersownNames: Map<number, string>
  status: YearStatus | null
  note: string | null
  isFirst: boolean
  isLast: boolean
  canInsert: boolean
  canRemove: boolean
  dragging: boolean
  dropTarget: boolean
  onCrop: (cropCode: number) => void
  onSelect: (code: number | null) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onInsertAfter: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
  onDrop: () => void
}

export const OwnRotationYearRow = ({
  farmId,
  number,
  year,
  cropName,
  nextCropCode,
  nextCropName,
  cropOptions,
  farmingSystem,
  undersownNames,
  status,
  note,
  isFirst,
  isLast,
  canInsert,
  canRemove,
  dragging,
  dropTarget,
  onCrop,
  onSelect,
  onMoveUp,
  onMoveDown,
  onInsertAfter,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: OwnRotationYearRowProps) => {
  const [pickerOpen, setPickerOpen] = useState(false)
  const label = `${number}. år`
  const yearCropName =
    year.cropCode === null ? '' : (cropName ?? `Afgrøde ${year.cropCode}`)
  const offered = useUndersownCropCodes(
    year.cropCode === null ? undefined : farmId,
    year.cropCode ?? undefined,
    farmingSystem ?? undefined,
    nextCropCode ?? undefined,
  )
  const offeredNames = new Map(
    (offered.data ?? []).map((option) => [option.code, option.name]),
  )
  const nameOf = (code: number) =>
    offeredNames.get(code) ?? undersownNames.get(code) ?? `Afgrøde ${code}`
  const isUnfit = (code: number) =>
    offered.data !== undefined && !offeredNames.has(code)
  const chips = year.undersownCropCodes
    .map((code) => ({ code, name: nameOf(code), unfit: isUnfit(code) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'da'))
  const unfitCount = chips.filter((chip) => chip.unfit).length
  const pickerOptions: UndersownOption[] = [
    ...chips.filter((chip) => chip.unfit),
    ...(offered.data ?? [])
      .map((option) => ({ ...option, unfit: false }))
      .sort((left, right) => left.name.localeCompare(right.name, 'da')),
  ]
  const statusLabel = status ? STATUS_LABEL[status] : null

  const startDrag = (event: DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', label)
    const row = event.currentTarget.closest('li')
    if (row) event.dataTransfer.setDragImage(row, 24, 20)
    onDragStart()
  }

  return (
    <li
      className={cn(
        'flex flex-wrap items-start gap-3 border-t px-4 py-2 sm:flex-nowrap',
        dropTarget && 'bg-primary/5',
        dragging && 'opacity-50',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <div className="flex h-10 w-13 shrink-0 items-center gap-1">
        <span
          draggable
          title={`Træk for at flytte ${label}`}
          className="cursor-grab text-muted-foreground/60 active:cursor-grabbing"
          onDragStart={startDrag}
          onDragEnd={onDragEnd}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </span>
        <span className="w-6 text-sm text-muted-foreground tabular-nums">
          <span aria-hidden="true">{number}.</span>
          <span className="sr-only">{label}</span>
        </span>
      </div>
      <CropPicker
        label={label}
        cropCode={year.cropCode}
        cropName={yearCropName}
        cropOptions={cropOptions}
        onChange={onCrop}
      />
      <div className="min-w-0 flex-1 basis-64">
        {year.cropCode === null ? (
          <p className="flex min-h-10 items-center text-[13px] text-muted-foreground">
            Vælg afgrøden først. Virkemidlerne afhænger af årets og næste års
            afgrøde.
          </p>
        ) : (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverAnchor asChild>
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 py-1.5">
                {chips.map((chip) => (
                  <span
                    key={chip.code}
                    title={
                      chip.unfit
                        ? `${chip.name}. Passer ikke længere til afgrøderne.`
                        : chip.name
                    }
                    className={cn(
                      'inline-flex h-7 max-w-80 min-w-0 items-center gap-1 rounded-md border pr-1 pl-2.5 text-[13px]',
                      chip.unfit
                        ? 'border-destructive/40 bg-destructive/5 text-destructive'
                        : CHOICE_SELECTED_CLASS,
                    )}
                  >
                    <span className="truncate">{chip.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Fjern ${chip.name} i ${label}`}
                      className="size-5 rounded-sm p-0 text-muted-foreground"
                      onClick={() => onSelect(null)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </span>
                ))}
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={`${chips.length === 0 ? 'Tilføj vinterdække/virkemiddel' : 'Skift virkemiddel'} i ${label}`}
                    className="h-7 gap-1 px-2.5 text-[13px] font-normal text-primary"
                  >
                    {chips.length === 0 ? (
                      <>
                        <Plus className="size-3.5" aria-hidden="true" />
                        Tilføj vinterdække/virkemiddel
                      </>
                    ) : (
                      'Skift virkemiddel'
                    )}
                  </Button>
                </PopoverTrigger>
              </div>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-175 max-w-[calc(100vw-2rem)] p-0"
            >
              <UndersownPicker
                label={label}
                cropName={yearCropName}
                nextCropName={nextCropName}
                farmingSystem={farmingSystem}
                offeredCount={offered.data ? offered.data.length : null}
                options={pickerOptions}
                selected={year.undersownCropCodes}
                failed={Boolean(offered.error)}
                retrying={offered.isValidating}
                onRetry={() => void offered.mutate()}
                onSelect={(code) => {
                  onSelect(code)
                  setPickerOpen(false)
                }}
                onClose={() => setPickerOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
        <div role="status">
          {note ? (
            <p className="pb-1.5 text-[13px] text-muted-foreground">{note}</p>
          ) : unfitCount > 0 ? (
            <p className="pb-1.5 text-[13px] text-destructive">
              {unfitCount === 1
                ? 'Et af virkemidlerne passer ikke længere til afgrøderne. Fjern det.'
                : `${unfitCount} af virkemidlerne passer ikke længere til afgrøderne. Fjern dem.`}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-10 w-15 shrink-0 flex-col items-end justify-center text-right text-[13px]">
        {statusLabel ? (
          <span className="text-[11px] leading-none font-semibold text-primary">
            {statusLabel}
          </span>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="mt-1 size-8 p-0 text-muted-foreground"
            aria-label={`Flere valg for ${label}`}
          >
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem disabled={isFirst} onSelect={onMoveUp}>
            <ArrowUp aria-hidden="true" />
            Flyt op
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={onMoveDown}>
            <ArrowDown aria-hidden="true" />
            Flyt ned
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canInsert} onSelect={onInsertAfter}>
            <Plus aria-hidden="true" />
            Sæt år ind efter
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canRemove}
            className="text-destructive focus:text-destructive"
            onSelect={onRemove}
          >
            <Trash2 aria-hidden="true" />
            Fjern året
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

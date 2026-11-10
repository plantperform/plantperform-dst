import { Copy, Ellipsis, Plus, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCropCodes, useUndersownCropCodes } from '@/api/hooks'
import { useMembers } from '@/api/members'
import {
  rotationDefinitionMembersPath,
  useOwnRotationDefinitions,
} from '@/api/own-rotations'
import type { RotationDefinition } from '@/api/types'
import { useAuth } from '@/auth/context'
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
import { OwnRotationShareButton } from '@/components/farm/OwnRotationShareButton'
import { OwnRotationsShareDialog } from '@/components/farm/OwnRotationsShareDialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Pending } from '@/components/ui/pending'
import { Skeleton } from '@/components/ui/skeleton'
import { cropGroupFor } from '@/lib/crop-groups'
import { describeFarmAccess, otherMemberEmails } from '@/lib/farm-access'
import { describeLastOpened } from '@/lib/farm-overview'
import {
  DELETE_ROTATION_DIALOG,
  definitionCropNames,
  describeYearCount,
} from '@/lib/own-rotations'
import { cn } from '@/lib/utils'

const ROW_GRID_CLASS =
  'grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-5 lg:grid-cols-[16px_minmax(0,1fr)_13rem_6.5rem_auto]'

const STACKED_CELL_CLASS =
  'col-span-2 col-start-2 lg:col-span-1 lg:col-start-auto'

const SharedWith = ({ definition }: { definition: RotationDefinition }) => {
  const { user } = useAuth()
  const { data: members } = useMembers(
    rotationDefinitionMembersPath(definition.id),
  )
  return members ? (
    describeFarmAccess(otherMemberEmails(members, user?.email ?? ''))
  ) : (
    <Skeleton className="h-3.5 w-20" />
  )
}

type OwnRotationRowProps = {
  farmId: string
  definition: RotationDefinition
  cropNames: Map<number, string>
  undersownNames: Map<number, string>
  selected: boolean
  copyDisabled: boolean
  onSelect: (selected: boolean) => void
  onCopy: () => void
  onDelete: () => void
}

const OwnRotationRow = ({
  farmId,
  definition,
  cropNames,
  undersownNames,
  selected,
  copyDisabled,
  onSelect,
  onCopy,
  onDelete,
}: OwnRotationRowProps) => {
  const positions = definition.variants[0]?.positions ?? []
  const subtitle = [
    definition.farmingSystem ?? 'Uden driftsform',
    describeYearCount(positions.length),
    definition.variants.length > 1
      ? `${definition.variants.length} udgaver`
      : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <li
      className={cn(
        ROW_GRID_CLASS,
        'relative py-3.5 transition-colors',
        selected ? 'bg-primary/5' : 'hover:bg-muted/40',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Vælg ${definition.name}`}
        className="relative z-10 mt-1 size-4 accent-primary"
        onChange={(event) => onSelect(event.target.checked)}
      />
      <div className="min-w-0">
        <Link
          to={ownRotationPath(farmId, definition.id)}
          className="block truncate rounded-sm font-display text-[19px] leading-6 after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {definition.name}
        </Link>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <span
        className={cn(
          STACKED_CELL_CLASS,
          'truncate text-[13px] text-muted-foreground lg:pt-1',
        )}
      >
        <SharedWith definition={definition} />
      </span>
      <span className="hidden pt-1 text-[13px] text-muted-foreground lg:block">
        {definition.updatedAt
          ? describeLastOpened(Date.parse(definition.updatedAt))
          : null}
      </span>
      <div className="relative z-10 col-start-3 row-start-1 flex items-center gap-1 lg:col-start-auto lg:row-start-auto">
        <OwnRotationShareButton definition={definition} size="xs" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="size-8 p-0 text-muted-foreground"
              aria-label={`Flere valg for ${definition.name}`}
            >
              <Ellipsis className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={copyDisabled} onSelect={onCopy}>
              <Copy aria-hidden="true" />
              Kopier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDelete}
            >
              <Trash2 aria-hidden="true" />
              Slet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ol
        aria-label={`Afgrøder i ${definition.name}`}
        className="col-span-2 col-start-2 mt-1 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4 gap-y-2 lg:col-span-4 lg:col-start-2"
      >
        {positions.map((position, index) => {
          const name =
            cropNames.get(position.cropCode) ?? `Afgrøde ${position.cropCode}`
          const undersownCode = position.allowedUndersownCropCodes[0]
          return (
            <li key={index} className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px]">
                <CropGroupTile group={cropGroupFor(position.cropCode, name)} />
                <span className="truncate">{name}</span>
              </span>
              <span
                className={cn(
                  'mt-0.5 block truncate pl-6 text-[11.5px]',
                  undersownCode === undefined
                    ? 'text-muted-foreground/70'
                    : 'text-muted-foreground',
                )}
              >
                {undersownCode === undefined
                  ? 'Intet virkemiddel'
                  : (undersownNames.get(undersownCode) ??
                    `Afgrøde ${undersownCode}`)}
              </span>
            </li>
          )
        })}
      </ol>
    </li>
  )
}

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
  const [toDelete, setToDelete] = useState<RotationDefinition | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sharingSelected, setSharingSelected] = useState(false)
  const cropNames = new Map(
    (crops.data ?? []).map((crop) => [crop.code, crop.name]),
  )
  const undersownNames = new Map(
    (undersown.data ?? []).map((option) => [option.code, option.name]),
  )
  const own = (definitions.data ?? []).toSorted((left, right) =>
    left.name.localeCompare(right.name, 'da'),
  )
  const search = query.trim().toLocaleLowerCase('da')
  const shown = own.filter(
    (definition) =>
      search === '' ||
      [definition.name, ...definitionCropNames(definition, cropNames)]
        .join(' ')
        .toLocaleLowerCase('da')
        .includes(search),
  )
  const selected = own.filter((definition) =>
    selectedIds.includes(definition.id),
  )
  const shownSelectedCount = shown.filter((definition) =>
    selectedIds.includes(definition.id),
  ).length
  const allShownSelected =
    shown.length > 0 && shownSelectedCount === shown.length

  const select = (ids: string[], checked: boolean) =>
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
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
        {definitions.data && crops.data ? (
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
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <FarmSearchInput
                  className="w-72 max-w-full"
                  value={query}
                  onChange={setQuery}
                  placeholder="Søg på navn eller afgrøde"
                  label="Søg i egne sædskifter"
                />
                {selected.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selected.length} valgt
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds([])}
                    >
                      Fravælg
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setSharingSelected(true)}
                    >
                      <UserPlus aria-hidden="true" />
                      Del valgte
                    </Button>
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    Sæt flueben for at dele flere på en gang.
                  </p>
                )}
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ingen sædskifter matcher "{query.trim()}".
                </p>
              ) : (
                <div className={FARM_LIST_CLASS}>
                  <div
                    className={cn(
                      ROW_GRID_CLASS,
                      'py-2.5 text-xs text-muted-foreground',
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label="Vælg alle viste sædskifter"
                      checked={allShownSelected}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate =
                            shownSelectedCount > 0 && !allShownSelected
                        }
                      }}
                      className="size-4 accent-primary"
                      onChange={(event) =>
                        select(
                          shown.map((definition) => definition.id),
                          event.target.checked,
                        )
                      }
                    />
                    <span>Sædskifte og afgrøder år for år</span>
                    <span className="hidden lg:block">Deling</span>
                    <span className="hidden lg:block">Ændret</span>
                    <span />
                  </div>
                  <ul className="divide-y">
                    {shown.map((definition) => (
                      <OwnRotationRow
                        key={definition.id}
                        farmId={farmId}
                        definition={definition}
                        cropNames={cropNames}
                        undersownNames={undersownNames}
                        selected={selectedIds.includes(definition.id)}
                        copyDisabled={actions.copyingId !== null}
                        onSelect={(checked) => select([definition.id], checked)}
                        onCopy={() => void actions.copy(definition)}
                        onDelete={() => setToDelete(definition)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )
        ) : (
          <Pending
            failed={Boolean(definitions.error || crops.error)}
            failure="Sædskifterne kunne ikke hentes."
            loading="Henter sædskifterne..."
            retrying={definitions.isValidating || crops.isValidating}
            onRetry={() => {
              void definitions.mutate()
              void crops.mutate()
            }}
          />
        )}
      </div>
      <OwnRotationsShareDialog
        definitions={selected}
        open={sharingSelected}
        onOpenChange={setSharingSelected}
        onShared={() => {
          setSharingSelected(false)
          setSelectedIds([])
        }}
      />
      <ConfirmDialog
        {...DELETE_ROTATION_DIALOG}
        name={toDelete?.name ?? null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
        onConfirm={() => {
          if (toDelete) void actions.remove(toDelete)
        }}
      />
    </div>
  )
}

import { ChevronRight, Plus, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useCropCodes } from '@/api/hooks'
import { useMembers } from '@/api/members'
import {
  rotationDefinitionMembersPath,
  useOwnRotationDefinitions,
} from '@/api/own-rotations'
import type { RotationDefinition } from '@/api/types'
import { useAuth } from '@/auth/context'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { FARM_LIST_CLASS } from '@/components/farm/FarmList'
import { FarmSearchInput } from '@/components/farm/FarmSearchInput'
import { LibraryRotationCopyDialog } from '@/components/farm/LibraryRotationCopyDialog'
import {
  NEW_OWN_ROTATION_ID,
  ownRotationPath,
  useOwnRotationActions,
} from '@/components/farm/own-rotations-state'
import { OwnRotationsShareDialog } from '@/components/farm/OwnRotationsShareDialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Pending } from '@/components/ui/pending'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCount } from '@/lib/economics'
import { describeFarmAccess, otherMemberEmails } from '@/lib/farm-access'
import {
  DELETE_ROTATION_DIALOG,
  definitionCropNames,
  describeYearCount,
} from '@/lib/own-rotations'
import { cn } from '@/lib/utils'

const ROW_GRID_CLASS =
  'grid grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-x-4 gap-y-1 px-5 lg:grid-cols-[16px_minmax(12rem,1fr)_minmax(0,1fr)_11rem_16px]'

const STACKED_CELL_CLASS = 'col-start-2 lg:col-start-auto'

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
  crops: string[]
  selected: boolean
  onSelect: (selected: boolean) => void
}

const OwnRotationRow = ({
  farmId,
  definition,
  crops,
  selected,
  onSelect,
}: OwnRotationRowProps) => {
  const subtitle = [
    definition.farmingSystem ?? 'Uden driftsform',
    describeYearCount(crops.length),
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
        className="relative z-10 size-4 accent-primary"
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
      <p className={cn(STACKED_CELL_CLASS, 'truncate text-[13px]')}>
        {crops.join(' · ')}
      </p>
      <span
        className={cn(
          STACKED_CELL_CLASS,
          'truncate text-[13px] text-muted-foreground',
        )}
      >
        <SharedWith definition={definition} />
      </span>
      <ChevronRight
        className="col-start-3 row-start-1 size-4 text-muted-foreground lg:col-start-auto lg:row-start-auto"
        aria-hidden="true"
      />
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
  const actions = useOwnRotationActions(farmId)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sharingSelected, setSharingSelected] = useState(false)
  const [deletingSelected, setDeletingSelected] = useState(false)
  const cropNames = new Map(
    (crops.data ?? []).map((crop) => [crop.code, crop.name]),
  )
  const own = (definitions.data ?? [])
    .toSorted((left, right) => left.name.localeCompare(right.name, 'da'))
    .map((definition) => ({
      definition,
      crops: definitionCropNames(definition, cropNames),
    }))
  const search = query.trim().toLocaleLowerCase('da')
  const shown = own.filter(
    ({ definition, crops }) =>
      search === '' ||
      [definition.name, ...crops]
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">
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
                          shown.map(({ definition }) => definition.id),
                          event.target.checked,
                        )
                      }
                    />
                    <span>Sædskifte</span>
                    <span className="hidden lg:block">Afgrøder</span>
                    <span className="hidden lg:block">Deling</span>
                    <span />
                  </div>
                  <ul className="divide-y">
                    {shown.map(({ definition, crops }) => (
                      <OwnRotationRow
                        key={definition.id}
                        farmId={farmId}
                        definition={definition}
                        crops={crops}
                        selected={selectedIds.includes(definition.id)}
                        onSelect={(checked) => select([definition.id], checked)}
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

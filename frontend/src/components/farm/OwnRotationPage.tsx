import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Library,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { useCropCodes, useUndersownCropCodes } from '@/api/hooks'
import { useMembers } from '@/api/members'
import {
  rotationDefinitionMembersPath,
  useLibraryRotationDefinitions,
  useOwnRotationDefinitions,
  useUndersownCropCodeLoader,
} from '@/api/own-rotations'
import type {
  CropCodeOption,
  FarmingSystem,
  RotationDefinition,
} from '@/api/types'
import { useAuth } from '@/auth/context'
import { BackLink } from '@/components/BackLink'
import { LeaveFlowDialog } from '@/components/LeaveFlowDialog'
import { ConfirmDialog } from '@/components/farm/ConfirmDialog'
import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { LibraryRotationCopyDialog } from '@/components/farm/LibraryRotationCopyDialog'
import { OwnRotationSaveBar } from '@/components/farm/OwnRotationSaveBar'
import { OwnRotationShareButton } from '@/components/farm/OwnRotationShareButton'
import {
  OwnRotationYearHeader,
  OwnRotationYearRow,
  OwnRotationYearView,
} from '@/components/farm/OwnRotationYearRow'
import {
  NEW_OWN_ROTATION_ID,
  ROTATION_GONE,
  ownRotationsPath,
  useOwnRotationActions,
  type SaveFailure,
} from '@/components/farm/own-rotations-state'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pending } from '@/components/ui/pending'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useLeaveGuard } from '@/hooks/use-leave-guard'
import { cropGroupFor } from '@/lib/crop-groups'
import { FARMING_SYSTEMS } from '@/lib/economics'
import { isNameTaken } from '@/lib/economics-profiles'
import { describeFarmAccess, otherMemberEmails } from '@/lib/farm-access'
import {
  DELETE_ROTATION_DIALOG,
  MAX_ROTATION_YEARS,
  addYear,
  creationChecklist,
  defaultUndersownCrop,
  describeLostChanges,
  describeRemovedUndersown,
  describeYearCount,
  draftChangeCount,
  draftFromDefinition,
  insertYearAfter,
  isDraftChanged,
  keepAllowedUndersownCrops,
  libraryCropOptions,
  libraryUndersownDefaults,
  moveYear,
  newOwnRotationDraft,
  nextYearIndex,
  removeVariant,
  removeYear,
  setYearCrop,
  setYearUndersownCrop,
  yearStatus,
  yearsToRecheck,
  type OwnRotationDraft,
} from '@/lib/own-rotations'
import type { InitialRotations } from '@/lib/simulation-form'
import { formatCreatedAt } from '@/lib/simulation-overview'
import { cn } from '@/lib/utils'

const noteKey = (
  variantIndex: number,
  yearIndex: number,
  cropCode: number | null,
  nextCropCode: number | null,
  farmingSystem: FarmingSystem | null,
) => [variantIndex, yearIndex, cropCode, nextCropCode, farmingSystem].join(':')

const PageFrame = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4 px-6 pt-7 pb-8 sm:px-10">
      {children}
    </div>
  </div>
)

const SharedWith = ({ definition }: { definition: RotationDefinition }) => {
  const { user } = useAuth()
  const { data: members = [] } = useMembers(
    rotationDefinitionMembersPath(definition.id),
  )
  const others = otherMemberEmails(members, user?.email ?? '')
  return others.length === 0 ? null : <> · {describeFarmAccess(others)}</>
}

const RotationMeta = ({ definition }: { definition: RotationDefinition }) => (
  <p className="mt-2 text-sm text-muted-foreground">
    {[
      definition.farmingSystem ?? 'Uden driftsform',
      describeYearCount(definition.variants[0]?.positions.length ?? 0),
      definition.createdAt ? formatCreatedAt(definition.createdAt) : null,
    ]
      .filter(Boolean)
      .join(' · ')}
    <SharedWith definition={definition} />
  </p>
)

type DragState = { variantIndex: number; from: number; over: number }

type OwnRotationEditorProps = {
  farmId: string
  definition: RotationDefinition | null
  definitions: RotationDefinition[]
  cropOptions: CropCodeOption[]
  cropNames: Map<number, string>
  undersownDefaults: Map<string, number>
  onUseInSimulation: (rotations: InitialRotations) => void
}

const OwnRotationEditor = ({
  farmId,
  definition,
  definitions,
  cropOptions,
  cropNames,
  undersownDefaults,
  onUseInSimulation,
}: OwnRotationEditorProps) => {
  const actions = useOwnRotationActions(farmId)
  const { showError } = useToast()
  const navigate = useNavigate()
  const nameId = useId()
  const formId = useId()
  const [base, setBase] = useState(definition)
  const [draft, setDraft] = useState(() =>
    definition ? draftFromDefinition(definition) : newOwnRotationDraft(),
  )
  const [editing, setEditing] = useState(definition === null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [openVariant, setOpenVariant] = useState<number | null>(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<DragState | null>(null)
  const [rechecking, setRechecking] = useState(0)
  const loadUndersownCropCodes = useUndersownCropCodeLoader(farmId)
  const allUndersown = useUndersownCropCodes(farmId)
  const changed = isDraftChanged(draft, base)
  const leaveGuard = useLeaveGuard(changed && !(saving && base === null))

  if (
    definition &&
    base &&
    definition.revision > base.revision &&
    !changed &&
    !saving
  ) {
    setBase(definition)
    setDraft(draftFromDefinition(definition))
    setNotes({})
    setFailure(null)
  }

  const undersownNames = new Map(
    (allUndersown.data ?? []).map((option) => [option.code, option.name]),
  )
  const saved = base ? draftFromDefinition(base) : null
  const changeCount = saved && changed ? draftChangeCount(draft, saved) : 0
  const nameTaken = !saving && isNameTaken(definitions, draft.name, base?.id)
  const checklist = creationChecklist(draft, nameTaken)
  const locked = failure?.conflict === true
  const canSave =
    !saving &&
    !locked &&
    rechecking === 0 &&
    checklist.every((step) => step.done) &&
    (base === null || changed)
  const overview = ownRotationsPath(farmId)
  const cropName = (code: number | null) =>
    code === null ? null : (cropNames.get(code) ?? null)

  const leaveToOverview = () => {
    leaveGuard.release()
    navigate(overview, { replace: true })
  }

  const recheck = async (
    before: OwnRotationDraft,
    after: OwnRotationDraft,
    reason: string,
  ) => {
    setRechecking((count) => count + 1)
    const checks = await Promise.all(
      yearsToRecheck(before, after).map(async ({ variantIndex, yearIndex }) => {
        const years = after.variants[variantIndex].years
        const year = years[yearIndex]
        const nextCropCode =
          years[nextYearIndex(years.length, yearIndex)].cropCode
        if (year.cropCode === null || nextCropCode === null) return null
        try {
          const options = await loadUndersownCropCodes(
            year.cropCode,
            after.farmingSystem,
            nextCropCode,
          )
          const allowed = new Set(options.map((option) => option.code))
          return { variantIndex, yearIndex, year, nextCropCode, allowed }
        } catch {
          return null
        }
      }),
    )
    setRechecking((count) => count - 1)
    const fits = (
      current: OwnRotationDraft,
      check: (typeof checks)[number],
    ) => {
      if (check === null) return false
      const years = current.variants[check.variantIndex]?.years ?? []
      const year = years[check.yearIndex]
      return (
        year?.cropCode === check.year.cropCode &&
        current.farmingSystem === after.farmingSystem &&
        years[nextYearIndex(years.length, check.yearIndex)].cropCode ===
          check.nextCropCode
      )
    }
    setDraft((current) =>
      checks.reduce(
        (result, check) =>
          check !== null && fits(result, check)
            ? keepAllowedUndersownCrops(
                result,
                check.variantIndex,
                check.yearIndex,
                check.allowed,
              )
            : result,
        current,
      ),
    )
    const removed = checks.flatMap((check) => {
      if (check === null) return []
      const count = check.year.undersownCropCodes.filter(
        (code) => !check.allowed.has(code),
      ).length
      return count > 0
        ? [
            [
              noteKey(
                check.variantIndex,
                check.yearIndex,
                check.year.cropCode,
                check.nextCropCode,
                after.farmingSystem,
              ),
              describeRemovedUndersown(count, reason),
            ] as const,
          ]
        : []
    })
    if (removed.length > 0) {
      setNotes((current) => ({ ...current, ...Object.fromEntries(removed) }))
    }
  }

  const change = (next: OwnRotationDraft, reason: string | null) => {
    setDraft(next)
    setNotes({})
    if (reason !== null) void recheck(draft, next, reason)
  }

  const removeVariantAt = (variantIndex: number) => {
    change(removeVariant(draft, variantIndex), null)
    setOpenVariant((current) => {
      if (current === null || current < variantIndex) return current
      return current === variantIndex ? 0 : current - 1
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setFailure(null)
    if (base === null) {
      const result = await actions.create(draft)
      setSaving(false)
      setFailure(result)
      return
    }
    const result = await actions.save(base, draft)
    setSaving(false)
    if ('conflict' in result) {
      setFailure(result)
      return
    }
    setBase(result)
    setDraft(draftFromDefinition(result))
    setNotes({})
    setEditing(false)
  }

  const loadLatest = async () => {
    const latest = (await actions.reload())?.find(
      (entry) => entry.id === base?.id,
    )
    if (!latest) {
      showError(ROTATION_GONE)
      leaveToOverview()
      return
    }
    if (base && latest.revision <= base.revision) {
      showError('Den nye udgave kunne ikke hentes. Prøv igen.')
      return
    }
    setBase(latest)
    setDraft(draftFromDefinition(latest))
    setNotes({})
    setFailure(null)
  }

  const cancel = () => {
    if (base) setDraft(draftFromDefinition(base))
    setNotes({})
    if (!locked) setFailure(null)
    setEditing(false)
  }

  const startSimulation = base
    ? () =>
        onUseInSimulation({
          rotationVariants: [base.id],
          farmingSystem: base.farmingSystem,
        })
    : null

  const yearsNote =
    draft.variants.length > 1
      ? 'Sædskiftet har flere afgrødefølger, fordi det er kopieret fra biblioteket. Optimeringen regner på dem alle.'
      : editing
        ? 'Træk i et år for at flytte det.'
        : null

  const renderYears = (variantIndex: number) => {
    const variant = draft.variants[variantIndex]
    const count = variant.years.length
    if (!editing) {
      return (
        <>
          <OwnRotationYearHeader editing={false} />
          <ol>
            {variant.years.map((year, yearIndex) => {
              const undersownCode = year.undersownCropCodes[0]
              return (
                <OwnRotationYearView
                  key={yearIndex}
                  number={yearIndex + 1}
                  cropCode={year.cropCode}
                  cropName={cropName(year.cropCode)}
                  undersownName={
                    undersownCode === undefined
                      ? null
                      : (undersownNames.get(undersownCode) ??
                        `Afgrøde ${undersownCode}`)
                  }
                />
              )
            })}
          </ol>
        </>
      )
    }
    return (
      <>
        <OwnRotationYearHeader editing />
        <ol>
          {variant.years.map((year, yearIndex) => {
            const nextCropCode =
              variant.years[nextYearIndex(count, yearIndex)].cropCode
            const here =
              drag !== null && drag.variantIndex === variantIndex ? drag : null
            return (
              <OwnRotationYearRow
                key={yearIndex}
                farmId={farmId}
                number={yearIndex + 1}
                year={year}
                cropName={cropName(year.cropCode)}
                nextCropCode={nextCropCode}
                nextCropName={cropName(nextCropCode)}
                cropOptions={cropOptions}
                farmingSystem={draft.farmingSystem}
                undersownNames={undersownNames}
                status={saved ? yearStatus(saved, variant, yearIndex) : null}
                note={
                  notes[
                    noteKey(
                      variantIndex,
                      yearIndex,
                      year.cropCode,
                      nextCropCode,
                      draft.farmingSystem,
                    )
                  ] ?? null
                }
                isFirst={yearIndex === 0}
                isLast={yearIndex === count - 1}
                canInsert={count < MAX_ROTATION_YEARS}
                canRemove={count > 1}
                dragging={here?.from === yearIndex}
                dropTarget={
                  here !== null &&
                  here.over === yearIndex &&
                  here.from !== yearIndex
                }
                onCrop={(cropCode) =>
                  change(
                    setYearCrop(
                      draft,
                      variantIndex,
                      yearIndex,
                      cropCode,
                      defaultUndersownCrop(
                        undersownDefaults,
                        cropCode,
                        draft.farmingSystem,
                      ),
                    ),
                    'afgrøden er skiftet',
                  )
                }
                onSelect={(code) =>
                  setDraft(
                    setYearUndersownCrop(draft, variantIndex, yearIndex, code),
                  )
                }
                onMoveUp={() =>
                  change(
                    moveYear(draft, variantIndex, yearIndex, yearIndex - 1),
                    'rækkefølgen er ændret',
                  )
                }
                onMoveDown={() =>
                  change(
                    moveYear(draft, variantIndex, yearIndex, yearIndex + 1),
                    'rækkefølgen er ændret',
                  )
                }
                onInsertAfter={() =>
                  change(
                    insertYearAfter(draft, variantIndex, yearIndex),
                    'rækkefølgen er ændret',
                  )
                }
                onRemove={() =>
                  change(
                    removeYear(draft, variantIndex, yearIndex),
                    'rækkefølgen er ændret',
                  )
                }
                onDragStart={() =>
                  setDrag({ variantIndex, from: yearIndex, over: yearIndex })
                }
                onDragOver={() =>
                  setDrag((current) =>
                    current !== null &&
                    current.variantIndex === variantIndex &&
                    current.over !== yearIndex
                      ? { ...current, over: yearIndex }
                      : current,
                  )
                }
                onDragEnd={() => setDrag(null)}
                onDrop={() => {
                  if (here !== null && here.from !== yearIndex) {
                    change(
                      moveYear(draft, variantIndex, here.from, yearIndex),
                      'rækkefølgen er ændret',
                    )
                  }
                  setDrag(null)
                }}
              />
            )
          })}
        </ol>
      </>
    )
  }

  const renderFooter = (variantIndex: number) => {
    const years = draft.variants[variantIndex].years
    const first = years[0].cropCode
    const whose = draft.variants.length > 1 ? 'udgaven' : 'sædskiftet'
    const full = years.length >= MAX_ROTATION_YEARS
    return (
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-background/60 px-4 py-2.5 text-[13px]">
        {editing ? (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={full}
              className="-ml-3 text-primary"
              onClick={() =>
                change(addYear(draft, variantIndex), 'rækkefølgen er ændret')
              }
            >
              <Plus aria-hidden="true" />
              Tilføj år
            </Button>
            {full ? (
              <span className="text-muted-foreground">
                Højst {MAX_ROTATION_YEARS} år
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="ml-auto text-muted-foreground">
          {first === null
            ? `Efter sidste år starter ${whose} forfra med 1. år.`
            : `Efter ${years.length}. år starter ${whose} forfra med 1. år, ${
                cropName(first) ?? `Afgrøde ${first}`
              }.`}
        </p>
      </div>
    )
  }

  const renderVariantRow = (variantIndex: number) => {
    const variant = draft.variants[variantIndex]
    const open = openVariant === variantIndex
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-background/60 px-4 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={open}
          className="-ml-3 font-semibold"
          onClick={() => setOpenVariant(open ? null : variantIndex)}
        >
          {open ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
          Udgave {variantIndex + 1}
        </Button>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {variant.years.map((year, yearIndex) => {
            if (year.cropCode === null) return null
            const name = cropName(year.cropCode) ?? `Afgrøde ${year.cropCode}`
            return (
              <span
                key={yearIndex}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <CropGroupTile group={cropGroupFor(year.cropCode, name)} />
                {name}
              </span>
            )
          })}
        </span>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => removeVariantAt(variantIndex)}
          >
            <Trash2 aria-hidden="true" />
            Fjern udgaven
          </Button>
        ) : null}
      </div>
    )
  }

  const lostChanges = saved && locked ? describeLostChanges(draft, saved) : null
  const showStart =
    base === null && draft.variants[0].years[0].cropCode === null

  return (
    <PageFrame>
      <BackLink to={overview}>Tilbage til Egne sædskifter</BackLink>
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-4xl tracking-tight break-words">
            {draft.name.trim() || base?.name || 'Nyt sædskifte'}
          </h1>
          {base ? <RotationMeta definition={base} /> : null}
        </div>
        {base ? (
          <div className="flex flex-wrap gap-2">
            {editing ? null : (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                Rediger
              </Button>
            )}
            <OwnRotationShareButton
              definition={base}
              onLeft={leaveToOverview}
            />
            <Button
              type="button"
              variant="outline"
              disabled={changed || actions.copyingId !== null}
              loading={actions.copyingId === base.id}
              onClick={() => void actions.copy(base)}
            >
              <Copy aria-hidden="true" />
              Kopier
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 aria-hidden="true" />
              Slet
            </Button>
          </div>
        ) : showStart ? (
          <LibraryRotationCopyDialog
            cropNames={cropNames}
            copyingId={actions.copyingId}
            onCopy={(definition) =>
              actions.copy(definition, leaveGuard.release)
            }
            trigger={
              <Button type="button" variant="outline">
                <Library aria-hidden="true" />
                Start fra et sædskifte i biblioteket
              </Button>
            }
          />
        ) : null}
      </header>

      {locked ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
        >
          <AlertTriangle
            className="size-5 shrink-0 text-warning-strong"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-sm">
            <b className="font-semibold">
              Sædskiftet er rettet et andet sted, siden du åbnede det.
            </b>{' '}
            Hent den nye udgave, før du retter videre.
            {lostChanges ? (
              <span className="text-muted-foreground"> {lostChanges}</span>
            ) : null}
          </p>
          <Button type="button" onClick={() => void loadLatest()}>
            Hent den nye udgave
          </Button>
        </div>
      ) : null}

      <form id={formId} onSubmit={submit} className="contents">
        <div
          inert={locked || saving}
          className={cn('flex flex-col gap-3', locked && 'opacity-55')}
        >
          {editing ? (
            <Card className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <div className="w-full space-y-1 sm:w-80">
                  <Label
                    htmlFor={nameId}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Navn
                  </Label>
                  <Input
                    id={nameId}
                    value={draft.name}
                    maxLength={120}
                    autoFocus
                    aria-invalid={nameTaken || undefined}
                    aria-describedby={nameTaken ? `${nameId}-error` : undefined}
                    placeholder="Fx Korn og raps"
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Driftsform</p>
                  <SegmentedControl
                    aria-label="Driftsform"
                    value={draft.farmingSystem ?? ''}
                    options={FARMING_SYSTEMS}
                    labelClassName=""
                    onValueChange={(value) => {
                      if (value !== '') {
                        change(
                          { ...draft, farmingSystem: value },
                          'driftsformen er skiftet',
                        )
                      }
                    }}
                  />
                </div>
                <p className="min-w-60 flex-1 pb-2 text-xs text-muted-foreground">
                  Driftsformen afgør, hvilke virkemidler du kan vælge. En
                  simulering regner med sin egen driftsform.
                </p>
              </div>
              <FieldError
                id={`${nameId}-error`}
                message={
                  nameTaken
                    ? 'Der findes allerede et sædskifte med det navn.'
                    : null
                }
              />
            </Card>
          ) : null}

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
              <h2 className="text-base font-semibold">
                {draft.variants.length > 1
                  ? `År for år, ${draft.variants.length} udgaver`
                  : 'År for år'}
              </h2>
              {yearsNote ? (
                <p className="text-xs text-muted-foreground">{yearsNote}</p>
              ) : null}
            </div>
            {draft.variants.length === 1 ? (
              <>
                {renderYears(0)}
                {renderFooter(0)}
              </>
            ) : (
              draft.variants.map((variant, variantIndex) => (
                <section key={variant.id ?? variantIndex}>
                  {renderVariantRow(variantIndex)}
                  {openVariant === variantIndex ? (
                    <>
                      {renderYears(variantIndex)}
                      {renderFooter(variantIndex)}
                    </>
                  ) : null}
                </section>
              ))
            )}
          </Card>
        </div>
      </form>
      <OwnRotationSaveBar
        formId={formId}
        editing={editing}
        isNew={base === null}
        changed={changed}
        changeCount={changeCount}
        locked={locked}
        saving={saving}
        canSave={canSave}
        checklist={checklist}
        savedAt={base?.updatedAt ?? null}
        failure={failure && !failure.conflict ? failure.message : null}
        onCancel={() => (changed ? setConfirmingCancel(true) : cancel())}
        onUseInSimulation={startSimulation}
      />

      <LeaveFlowDialog
        blocker={leaveGuard.blocker}
        title={
          base
            ? `Forlad ${base.name} uden at gemme?`
            : 'Forlad Nyt sædskifte uden at gemme?'
        }
        description={
          base
            ? 'Dine ændringer gemmes ikke.'
            : 'Det, du har bygget, gemmes ikke.'
        }
      />
      <ConfirmDialog
        name={confirmingCancel && base ? base.name : null}
        title={`Annuller ændringerne i ${base?.name}?`}
        description="Det, du har rettet, gemmes ikke."
        confirmLabel="Annuller ændringer"
        cancelLabel="Ret videre"
        onOpenChange={(open) => {
          if (!open) setConfirmingCancel(false)
        }}
        onConfirm={cancel}
      />
      <ConfirmDialog
        {...DELETE_ROTATION_DIALOG}
        name={confirmingDelete && base ? base.name : null}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(false)
        }}
        onConfirm={() => {
          if (!base) return
          void actions.remove(base).then((removed) => {
            if (removed) leaveToOverview()
          })
        }}
      />
    </PageFrame>
  )
}

type OwnRotationPageProps = {
  farmId: string
  onUseInSimulation: (rotations: InitialRotations) => void
}

export const OwnRotationPage = ({
  farmId,
  onUseInSimulation,
}: OwnRotationPageProps) => {
  const { rotationId } = useParams()
  const definitions = useOwnRotationDefinitions()
  const library = useLibraryRotationDefinitions()
  const crops = useCropCodes(farmId)

  if (!definitions.data || !library.data || !crops.data) {
    return (
      <PageFrame>
        <Pending
          failed={Boolean(definitions.error || library.error || crops.error)}
          failure="Sædskifterne kunne ikke hentes."
          loading="Henter sædskifterne..."
          retrying={
            definitions.isValidating ||
            library.isValidating ||
            crops.isValidating
          }
          onRetry={() => {
            void definitions.mutate()
            void library.mutate()
            void crops.mutate()
          }}
        />
      </PageFrame>
    )
  }

  const definition =
    rotationId === NEW_OWN_ROTATION_ID
      ? null
      : definitions.data.find((entry) => entry.id === rotationId)
  if (definition === undefined) {
    return <Navigate to={ownRotationsPath(farmId)} replace />
  }

  return (
    <OwnRotationEditor
      key={definition?.id ?? NEW_OWN_ROTATION_ID}
      farmId={farmId}
      definition={definition}
      definitions={definitions.data}
      cropOptions={libraryCropOptions(crops.data, library.data)}
      cropNames={new Map(crops.data.map((crop) => [crop.code, crop.name]))}
      undersownDefaults={libraryUndersownDefaults(library.data)}
      onUseInSimulation={onUseInSimulation}
    />
  )
}

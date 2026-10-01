import { SlidersHorizontal } from 'lucide-react'
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type { FieldRecord, Simulation } from '@/api/types'
import { FieldRulesCard } from '@/components/farm/FieldRulesCard'
import { useRulesLimits } from '@/components/farm/rules-limits-state'
import { UnsavedDot } from '@/components/farm/rules-ui'
import { RulesLimitsCard } from '@/components/farm/RulesLimitsCard'
import { SimulationBasisCard } from '@/components/farm/SimulationBasisCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isFieldLocked } from '@/lib/field-domain'
import { cn } from '@/lib/utils'

type RulesTab = 'limits' | 'basis' | 'fields'

const RULES_TABS: RulesTab[] = ['limits', 'basis', 'fields']

const TAB_LABELS: Record<RulesTab, string> = {
  limits: 'Grænser',
  basis: 'Grundlag',
  fields: 'Marker',
}

type LeaveRequest = {
  tab: RulesTab
  sections: string
}

type UnsavedLimitsDialogProps = {
  request: LeaveRequest | null
  saving: boolean
  onStay: () => void
  onDiscard: () => void
  onSave: () => void
}

const UnsavedLimitsDialog = ({
  request,
  saving,
  onStay,
  onDiscard,
  onSave,
}: UnsavedLimitsDialogProps) => (
  <Dialog
    open={request !== null}
    onOpenChange={(open) => {
      if (!open && !saving) onStay()
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Grænserne er ikke gemt</DialogTitle>
        <DialogDescription>
          Du har ændringer i{' '}
          <b className="font-semibold text-foreground">{request?.sections}</b>,
          som ikke er gemt. Gem dem, eller fortryd dem, før du går til{' '}
          {request ? TAB_LABELS[request.tab] : null}.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onStay}>
          Bliv på Grænser
        </Button>
        <Button variant="outline" disabled={saving} onClick={onDiscard}>
          Fortryd ændringer
        </Button>
        <Button loading={saving} onClick={onSave}>
          Gem grænser
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

type SimulationRulesPanelProps = {
  farmId: string
  simulation: Simulation
  fields: FieldRecord[]
  lockingFieldId: string | null
  hoveredFieldId: string | null
  focusRequest?: { fieldId: string; nonce: number }
  onHoveredFieldChange: (fieldId: string | null) => void
  onToggleLock: (field: FieldRecord) => void
  onBindRotation: (field: FieldRecord) => void
}

export const SimulationRulesPanel = ({
  farmId,
  simulation,
  fields,
  lockingFieldId,
  hoveredFieldId,
  focusRequest,
  onHoveredFieldChange,
  onToggleLock,
  onBindRotation,
}: SimulationRulesPanelProps) => {
  const id = useId()
  const limits = useRulesLimits(farmId, simulation, fields)
  const [tab, setTab] = useState<RulesTab>('limits')
  const [leaveRequest, setLeaveRequest] = useState<LeaveRequest | null>(null)
  const [seenFocusNonce, setSeenFocusNonce] = useState(
    focusRequest?.nonce ?? null,
  )
  const tabElements = useRef(new Map<RulesTab, HTMLButtonElement>())

  const openTab = (next: RulesTab) => {
    if (next === tab) return
    if (tab === 'limits' && limits.isDirty && !limits.isSaving) {
      setLeaveRequest({ tab: next, sections: limits.changedSectionsLabel })
    } else {
      setTab(next)
    }
  }

  if (focusRequest && focusRequest.nonce !== seenFocusNonce) {
    setSeenFocusNonce(focusRequest.nonce)
    openTab('fields')
  }

  const discardAndLeave = () => {
    if (!leaveRequest) return
    limits.discard()
    setTab(leaveRequest.tab)
    setLeaveRequest(null)
  }

  const saveAndLeave = async () => {
    if (!leaveRequest) return
    const saved = await limits.save()
    if (saved) setTab(leaveRequest.tab)
    setLeaveRequest(null)
  }

  const moveTabFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: RulesTab,
  ) => {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = RULES_TABS.indexOf(current) + step + RULES_TABS.length
    tabElements.current.get(RULES_TABS[index % RULES_TABS.length])?.focus()
  }

  const lockedCount = fields.filter(isFieldLocked).length
  const tabStatus: Record<RulesTab, ReactNode> = {
    limits: limits.isDirty ? (
      <>
        <UnsavedDot />
        <span className="text-foreground">Ikke gemt</span>
      </>
    ) : (
      'For hele bedriften'
    ),
    basis: 'Låst ved oprettelse',
    fields: `${lockedCount} af ${fields.length} låst`,
  }

  const panelProps = (panel: RulesTab) => ({
    role: 'tabpanel',
    id: `${id}-${panel}-panel`,
    'aria-labelledby': `${id}-${panel}-tab`,
    hidden: tab !== panel,
  })

  return (
    <div className="@container flex min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="border-b border-rules/20 bg-rules/10 px-6 pt-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal
            className="size-4.5 text-rules"
            aria-hidden="true"
          />
          <h2 className="text-[15px] font-semibold">Regler</h2>
        </div>
        <p className="mt-1.5 max-w-190 text-[13px] text-muted-foreground">
          Her bestemmer du, hvad optimeringen må gøre: grænser for hele
          bedriften og marker, den ikke må ændre.
        </p>
        <div role="tablist" aria-label="Regler" className="mt-4 -mb-px flex">
          {RULES_TABS.map((entry) => {
            const active = entry === tab
            return (
              <button
                key={entry}
                ref={(element) => {
                  if (element) tabElements.current.set(entry, element)
                  else tabElements.current.delete(entry)
                }}
                type="button"
                role="tab"
                id={`${id}-${entry}-tab`}
                aria-selected={active}
                aria-controls={`${id}-${entry}-panel`}
                tabIndex={active ? 0 : -1}
                className={cn(
                  'group min-w-0 rounded-t-md border px-3.5 pt-2.5 pb-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @xl:w-44',
                  active
                    ? 'border-rules/20 border-b-background bg-background shadow-[inset_0_2px_0_var(--color-rules)]'
                    : 'border-transparent hover:bg-background/60',
                )}
                onClick={() => openTab(entry)}
                onKeyDown={(event) => moveTabFocus(event, entry)}
              >
                <span
                  className={cn(
                    'block text-[13px] font-semibold',
                    !active &&
                      'text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  {TAB_LABELS[entry]}
                </span>
                <span className="mt-px hidden items-center gap-1.5 truncate text-xs text-muted-foreground @xl:flex">
                  {tabStatus[entry]}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="px-6 pt-5 pb-6">
        <div {...panelProps('limits')}>
          <RulesLimitsCard limits={limits} fields={fields} />
        </div>
        <div {...panelProps('basis')}>
          <SimulationBasisCard simulation={simulation} />
        </div>
        <div {...panelProps('fields')}>
          <FieldRulesCard
            active={tab === 'fields'}
            fields={fields}
            lockingFieldId={lockingFieldId}
            hoveredFieldId={hoveredFieldId}
            focusRequest={focusRequest}
            onHoveredFieldChange={onHoveredFieldChange}
            onToggleLock={onToggleLock}
            onBindRotation={onBindRotation}
          />
        </div>
      </div>
      <UnsavedLimitsDialog
        request={leaveRequest}
        saving={limits.isSaving}
        onStay={() => setLeaveRequest(null)}
        onDiscard={discardAndLeave}
        onSave={() => void saveAndLeave()}
      />
    </div>
  )
}

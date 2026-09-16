import { AlertTriangle, Check } from 'lucide-react'
import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Status is decided by the form that owns the steps. The dialog only renders it.
export type StepStatus = 'complete' | 'invalid' | 'upcoming'

export type StepDialogStep = {
  id: string
  label: string
  status: StepStatus
}

type StepIndicatorProps = {
  steps: StepDialogStep[]
  currentIndex: number
  onStepSelect: (index: number) => void
  disabled?: boolean
}

const StepIndicator = ({
  steps,
  currentIndex,
  onStepSelect,
  disabled = false,
}: StepIndicatorProps) => {
  const current = steps[currentIndex]
  const progressPct = ((currentIndex + 1) / steps.length) * 100

  return (
    <nav aria-label="Trin">
      <div className="space-y-1.5 sm:hidden">
        <p className="text-xs font-medium text-muted-foreground">
          Trin {currentIndex + 1} af {steps.length} · {current?.label}
        </p>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Equal columns keep every connector the same length, whatever the labels. */}
      <ol
        className="hidden sm:grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex
          // Upcoming steps are only reachable through the form's own navigation,
          // which validates the steps in between.
          const isSelectable =
            !disabled && !isCurrent && step.status !== 'upcoming'
          return (
            <li
              key={step.id}
              className="relative flex min-w-0 justify-center"
            >
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!isSelectable}
                onClick={() => onStepSelect(index)}
                className={cn(
                  'group relative z-10 flex min-w-0 max-w-full flex-col items-center gap-1 rounded-md px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelectable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    isCurrent && 'border-primary bg-primary text-primary-foreground',
                    !isCurrent &&
                      step.status === 'complete' &&
                      'border-primary bg-primary/10 text-primary',
                    !isCurrent &&
                      step.status === 'invalid' &&
                      'border-amber-500 bg-amber-50 text-amber-700',
                    !isCurrent &&
                      step.status === 'upcoming' &&
                      'bg-background text-muted-foreground',
                    isSelectable && 'group-hover:border-primary',
                  )}
                >
                  {!isCurrent && step.status === 'complete' ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : !isCurrent && step.status === 'invalid' ? (
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    'truncate',
                    isCurrent
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                  {!isCurrent && step.status === 'invalid' ? (
                    <span className="sr-only"> (skal rettes)</span>
                  ) : null}
                </span>
              </button>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    // From just right of this circle to just left of the next one.
                    'absolute top-3.5 right-[calc(-50%+1.25rem)] left-[calc(50%+1.25rem)] h-px',
                    index < currentIndex ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type StepDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  steps: StepDialogStep[]
  currentIndex: number
  onStepSelect: (index: number) => void
  // Right-aligned actions, typically Tilbage and Næste.
  actions: React.ReactNode
  // Left-aligned secondary action, such as Start forfra.
  secondaryAction?: React.ReactNode
  // Shown under the actions, for example which fields block the next step.
  footerMessage?: React.ReactNode
  // Blocks every way of closing and of changing step, while a request runs.
  locked?: boolean
  children: React.ReactNode
}

export const StepDialog = ({
  open,
  onOpenChange,
  title,
  description,
  steps,
  currentIndex,
  onStepSelect,
  actions,
  secondaryAction,
  footerMessage,
  locked = false,
  children,
}: StepDialogProps) => {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = React.useState<number>()
  const [isGrowing, setIsGrowing] = React.useState(false)

  // The body follows its content's height so each step fits, and animates to
  // it because CSS cannot transition to height: auto in every browser. The
  // dialog's max height still caps the body, which then scrolls.
  const measureContent = React.useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    let previousHeight: number | undefined
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      const body = bodyRef.current
      // While the body animates towards taller content it is briefly too short,
      // which would flash a scrollbar. Scrolling is only held back if the body
      // fitted its content before, so a step that already scrolls keeps its
      // scrollbar and its rows do not shift sideways.
      const fitted =
        previousHeight === undefined ||
        !body ||
        previousHeight <= body.clientHeight + 1
      previousHeight = element.offsetHeight
      setContentHeight(previousHeight)
      if (!fitted) return
      setIsGrowing(true)
      window.clearTimeout(timer)
      // Slightly longer than the transition, and independent of transitionend,
      // which does not fire when the dialog's max height leaves nothing to animate.
      timer = window.setTimeout(() => setIsGrowing(false), 250)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  // Each step starts at the top, even if the previous one was scrolled.
  React.useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [currentIndex])

  const handleOpenChange = (nextOpen: boolean) => {
    if (locked && !nextOpen) return
    onOpenChange(nextOpen)
  }

  const current = steps[currentIndex]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!locked}
        className="flex max-h-[calc(100dvh-4rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:max-h-[calc(100dvh-2rem)]"
      >
        <DialogHeader className="space-y-4 border-b px-6 pt-6 pb-4">
          <div className="space-y-1.5 pr-6">
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </div>
          <StepIndicator
            steps={steps}
            currentIndex={currentIndex}
            onStepSelect={onStepSelect}
            disabled={locked}
          />
          <p role="status" className="sr-only">
            Trin {currentIndex + 1} af {steps.length}: {current?.label}
          </p>
        </DialogHeader>

        <div
          ref={bodyRef}
          className={cn(
            'min-h-0 shrink overflow-x-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none',
            isGrowing ? 'overflow-y-hidden' : 'overflow-y-auto',
          )}
          style={{ height: contentHeight }}
        >
          <div ref={measureContent} className="px-6 py-5">
            {children}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-6 py-4">
          {secondaryAction}
          {/* Next to the actions it explains. Always mounted, never display:none,
              so screen readers announce messages as they appear. */}
          <div aria-live="polite" className="ml-auto min-w-0 text-right text-xs">
            {footerMessage}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

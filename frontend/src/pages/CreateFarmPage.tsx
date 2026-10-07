import { ChevronLeft } from 'lucide-react'
import { useMemo, useState, type ComponentProps, type FormEvent } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
  type LinkProps,
} from 'react-router-dom'
import { mutate } from 'swr'

import { ApiError } from '@/api/client'
import {
  farmsKey,
  useFarms,
  useRegistryFieldsBulk,
  useRegistryFieldsByCvr,
} from '@/api/hooks'
import { createFarm, createFieldsFromRegistry } from '@/api/mutations'
import type { RegistryField } from '@/api/types'
import { AppTopBar } from '@/components/AppTopBar'
import { RegistryFieldsMap } from '@/components/farm/RegistryFieldsMap'
import {
  CreateStatus,
  LookupEmpty,
  LookupFound,
  LookupProgress,
  StepHeading,
} from '@/components/farm/RegistryLookup'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadError } from '@/components/ui/load-error'
import { usePacedStep } from '@/hooks/use-paced-step'
import {
  farmBasicsErrors,
  farmLookupErrors,
  formatCvr,
  isCvrComplete,
  toCvrDigits,
} from '@/lib/farm-form'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { summarizeLookup } from '@/lib/registry-lookup'
import { cn } from '@/lib/utils'

const STEPS = ['Bedrift', 'Marker', 'Første svar']

const GOOD_TO_KNOW = [
  {
    title: 'Hvad er et kystvandopland?',
    text: 'Det havområde, markens vand løber til. Bedriftens marker kan ligge i flere oplande, og kvoten gælder pr. opland, ikke for bedriften samlet.',
  },
  {
    title: 'Hvad er kvoten?',
    text: 'Hvor mange kg kvælstof (kg N) markerne i et opland tilsammen må udlede om året. Kvote = areal x udledningsgrænse, som staten fastsætter i et kortlag.',
  },
]

const CREATE_ERROR = 'Kunne ikke oprette bedriften. Prøv igen.'

const PROGRESS_STEP_MS = 1000

const LOOKUP_RESULT_STEP = 3

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

type FarmForm = {
  name: string
  ownerName: string
  cvr: string
}

type FailedCreate = {
  at: string
  farmId: string | null
}

const readForm = (state: unknown): FarmForm => {
  const prefill = (state as { prefill?: Record<string, unknown> } | null)
    ?.prefill
  const read = (key: keyof FarmForm) => {
    const value = prefill?.[key]
    return typeof value === 'string' ? value : ''
  }
  return {
    name: read('name'),
    ownerName: read('ownerName'),
    cvr: toCvrDigits(read('cvr')),
  }
}

type FormFieldProps = ComponentProps<'input'> & {
  id: string
  label: string
  error?: string
}

const FormField = ({
  id,
  label,
  error,
  className,
  children,
  ...inputProps
}: FormFieldProps) => (
  <div className="grid content-start gap-1.5">
    <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
      {label}
    </Label>
    <div className="flex gap-2.5">
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete="off"
        className={cn('min-w-0', className)}
        {...inputProps}
      />
      {children}
    </div>
    <FieldError id={`${id}-error`} message={error} />
  </div>
)

const BackLink = ({ className, children, ...linkProps }: LinkProps) => (
  <Link
    {...linkProps}
    className={cn(
      'mb-5 flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      className,
    )}
  >
    <ChevronLeft className="size-3.5" aria-hidden="true" />
    {children}
  </Link>
)

export const CreateFarmPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { data: farms } = useFarms()
  const paramCvr = searchParams.get('cvr') ?? ''
  const urlCvr = isCvrComplete(paramCvr) ? paramCvr : null
  const [form, setForm] = useState(() => {
    const initial = readForm(location.state)
    return { ...initial, cvr: initial.cvr || (urlCvr ?? '') }
  })
  const [checked, setChecked] = useState<'lookup' | 'create' | null>(null)
  const [creating, setCreating] = useState(false)
  const [failedCreate, setFailedCreate] = useState<FailedCreate | null>(null)
  const failedHere = failedCreate?.at === location.key ? failedCreate : null
  const createError = failedHere ? CREATE_ERROR : null

  const lookupForm = readForm(location.state)
  const lookupCvr =
    urlCvr !== null && lookupForm.name.trim() && lookupForm.ownerName.trim()
      ? urlCvr
      : null
  const activeStep = lookupCvr === null ? 0 : 1
  const search = useRegistryFieldsByCvr(lookupCvr ?? undefined, 500)
  const details = useRegistryFieldsBulk(
    (search.data ?? []).map((field) => field.imkId),
  )
  const found = details.data
  const summary = useMemo(
    () => (found ? summarizeLookup(found) : null),
    [found],
  )
  const lookupError: unknown = search.error ?? details.error
  const lookupProgress = !search.data
    ? 0
    : search.data.length > 0 && found
      ? LOOKUP_RESULT_STEP
      : 1
  const lookupStep = usePacedStep(
    lookupCvr ?? '',
    lookupProgress,
    PROGRESS_STEP_MS,
  )

  const errors =
    checked === 'lookup'
      ? farmLookupErrors(form.name, form.ownerName, form.cvr)
      : checked === 'create'
        ? farmBasicsErrors(form.name, form.ownerName, form.cvr)
        : {}

  const create = async (farm: FarmForm, registryFields: RegistryField[]) => {
    setCreating(true)
    setFailedCreate(null)
    let farmId = failedHere?.farmId ?? null
    try {
      const shown = pause(registryFields.length > 0 ? PROGRESS_STEP_MS : 0)
      farmId ??= (
        await createFarm({
          name: farm.name.trim(),
          ownerName: farm.ownerName.trim(),
          cvr: farm.cvr || null,
        })
      ).id
      if (registryFields.length > 0) {
        await createFieldsFromRegistry(farmId, registryFields)
      }
      await mutate(farmsKey)
      await shown
      navigate(`/farms/${farmId}`, { replace: true })
    } catch {
      setFailedCreate({ at: location.key, farmId })
      setCreating(false)
    }
  }

  const lookUp = (event: FormEvent) => {
    event.preventDefault()
    setChecked('lookup')
    const invalid = farmLookupErrors(form.name, form.ownerName, form.cvr)
    if (Object.keys(invalid).length > 0) return
    navigate({ search: `?cvr=${form.cvr}` }, { state: { prefill: form } })
  }

  const createWithoutLookup = () => {
    setChecked('create')
    const invalid = farmBasicsErrors(form.name, form.ownerName, form.cvr)
    if (Object.keys(invalid).length > 0) return
    void create(form, [])
  }

  const renderLookup = (cvr: string) => {
    const farm = { ...lookupForm, cvr }
    if (creating && found && found.length > 0) {
      return (
        <>
          <StepHeading title={`Opretter ${farm.name.trim()}`}>
            Det tager typisk 10 til 20 sekunder.
          </StepHeading>
          <LookupProgress phase="creating" fieldCount={found.length} />
        </>
      )
    }
    if (search.data?.length === 0 && lookupStep > 0) {
      return (
        <LookupEmpty
          cvr={cvr}
          creating={creating}
          error={createError}
          onEditCvr={() =>
            navigate('/farms/new', {
              state: { prefill: farm, focusCvr: true },
            })
          }
          onCreateEmpty={() => void create(farm, [])}
        />
      )
    }
    if (found && summary && !lookupError && lookupStep >= LOOKUP_RESULT_STEP) {
      return (
        <LookupFound
          farmName={farm.name.trim()}
          summary={summary}
          error={createError}
          onCreate={() => void create(farm, found)}
        />
      )
    }
    return (
      <>
        <StepHeading title={`Henter markerne for CVR ${formatCvr(cvr)}`}>
          Det tager normalt kun nogle få sekunder.
        </StepHeading>
        <LookupProgress
          phase={
            lookupStep === 0
              ? 'searching'
              : lookupStep === 1
                ? 'details'
                : 'found'
          }
          fieldCount={lookupStep > 0 ? (search.data?.length ?? null) : null}
          error={
            lookupError && lookupStep >= lookupProgress ? (
              <LoadError
                message={`Opslaget stoppede undervejs, og intet er oprettet.${lookupError instanceof ApiError ? ` Fejlkode ${lookupError.status}.` : ''}`}
                onRetry={() =>
                  void (search.error ? search.mutate() : details.mutate())
                }
                retrying={search.isValidating || details.isValidating}
              />
            ) : undefined
          }
        />
      </>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <AppTopBar>
        <ol className="hidden items-center gap-[26px] text-[13px] sm:flex">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === activeStep ? 'step' : undefined}
              className={
                index <= activeStep
                  ? 'font-semibold'
                  : 'text-brand-foreground/70'
              }
            >
              {index + 1} {label}
            </li>
          ))}
        </ol>
      </AppTopBar>
      <div className="mx-auto grid max-w-6xl justify-center gap-10 px-6 pt-10 pb-16 sm:px-10 lg:grid-cols-[640px_380px]">
        <div className="min-w-0">
          {lookupCvr !== null ? (
            <>
              <BackLink
                to="/farms/new"
                state={{ prefill: { ...lookupForm, cvr: lookupCvr } }}
                className={cn(creating && 'invisible')}
              >
                Tilbage
              </BackLink>
              {renderLookup(lookupCvr)}
            </>
          ) : (
            <>
              <BackLink
                to="/"
                state={HOME_OVERVIEW_STATE}
                className={cn(creating && 'invisible')}
              >
                Tilbage til bedrifter
              </BackLink>
              <StepHeading
                title={
                  farms && farms.length > 0
                    ? 'Ny bedrift. Lad os hente markerne.'
                    : 'Velkommen. Lad os hente markerne.'
                }
              >
                Du skal kun bruge bedriftens CVR-nummer. Marker, areal,
                jordtype, retention og kystvandopland kommer fra det danske
                markregister og statens kortlag.
              </StepHeading>
              <form
                className="grid gap-4 rounded-xl border bg-card p-6"
                onSubmit={lookUp}
                noValidate
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="farm-name"
                    label="Bedriftens navn"
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    error={errors.name}
                  />
                  <FormField
                    id="farm-owner-name"
                    label="Ejer"
                    value={form.ownerName}
                    onChange={(event) =>
                      setForm({ ...form, ownerName: event.target.value })
                    }
                    error={errors.ownerName}
                  />
                </div>
                <FormField
                  id="farm-cvr"
                  label="CVR-nummer"
                  value={formatCvr(form.cvr)}
                  onChange={(event) =>
                    setForm({ ...form, cvr: toCvrDigits(event.target.value) })
                  }
                  inputMode="numeric"
                  placeholder="8 cifre"
                  autoFocus={
                    (location.state as { focusCvr?: boolean } | null)
                      ?.focusCvr === true
                  }
                  className="tracking-[0.06em] tabular-nums"
                  error={errors.cvr}
                >
                  <Button type="submit" className="shrink-0 rounded-full">
                    Slå op i markregistret
                  </Button>
                </FormField>
                <p className="text-[12.5px] leading-normal text-muted-foreground">
                  Har bedriften ingen marker i registret? Du kan også{' '}
                  <button
                    type="button"
                    className="rounded-sm text-primary underline underline-offset-2 hover:text-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                    disabled={creating}
                    onClick={createWithoutLookup}
                  >
                    oprette bedriften uden marker
                  </button>
                  .
                </p>
                <CreateStatus creating={creating} error={createError} />
              </form>
            </>
          )}
        </div>
        <aside className="grid content-start gap-3.5 lg:pt-24">
          {GOOD_TO_KNOW.map((card) => (
            <section
              key={card.title}
              className="rounded-xl border bg-card px-5 py-[18px]"
            >
              <h2 className="mb-1 text-sm font-semibold">{card.title}</h2>
              <p className="text-[13px] leading-normal text-foreground/80">
                {card.text}
              </p>
            </section>
          ))}
          {lookupCvr !== null &&
          found &&
          summary &&
          found.length > 0 &&
          lookupStep >= LOOKUP_RESULT_STEP ? (
            <div className="rounded-xl border bg-card p-3">
              <div
                role="img"
                aria-label="Kort over de fundne marker farvet efter kystvandopland"
                className="h-[234px] overflow-hidden rounded-lg bg-muted"
              >
                <RegistryFieldsMap
                  fields={found}
                  catchments={summary.catchments}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Markerne farvet efter kystvandopland.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  )
}

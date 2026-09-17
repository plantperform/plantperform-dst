import { useState, type ComponentProps, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronLeft } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmsKey, useRegistryFieldsByCvr } from '@/api/hooks'
import { createFarm, importRegistryFields } from '@/api/mutations'
import { AppTopBar } from '@/components/AppTopBar'
import {
  CreateFarmPreview,
  type RegistryLookup,
} from '@/components/farm/CreateFarmPreview'
import { FieldError } from '@/components/ui/field-error'
import { Button } from '@/components/ui/button'
import { EYEBROW_CLASS } from '@/components/ui/eyebrow'
import { Label } from '@/components/ui/label'
import { farmBasicsErrors, type FarmBasicsErrors } from '@/lib/farm-form'
import { formatNumber } from '@/lib/field-domain'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const CVR_PATTERN = /^\d{8}$/

const readPrefillValue = (
  prefill: unknown,
  key: 'name' | 'ownerName' | 'cvr',
) => {
  if (typeof prefill !== 'object' || prefill === null) return ''
  const value = (prefill as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
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
  ...inputProps
}: FormFieldProps) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor={id} className="text-sm font-medium">
      {label}
    </Label>
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn(
        'h-[46px] w-full rounded-xl border bg-card px-3.5 text-[15px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15',
        error && 'border-red-600',
        className,
      )}
      {...inputProps}
    />
    <FieldError id={`${id}-error`} message={error} />
  </div>
)

export const CreateFarmPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: unknown } | null)?.prefill
  const [name, setName] = useState(() => readPrefillValue(prefill, 'name'))
  const [ownerName, setOwnerName] = useState(() =>
    readPrefillValue(prefill, 'ownerName'),
  )
  const [cvr, setCvr] = useState(() =>
    readPrefillValue(prefill, 'cvr').replace(/\D/g, '').slice(0, 8),
  )
  const [touched, setTouched] = useState(false)
  const [lookupCvr, setLookupCvr] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const cvrComplete = CVR_PATTERN.test(cvr)
  const lookupActive = lookupCvr !== null && lookupCvr === cvr
  const {
    data: registryFields,
    isLoading: lookupLoading,
    error: lookupError,
  } = useRegistryFieldsByCvr(lookupActive ? cvr : undefined, 500)
  const lookup: RegistryLookup | null =
    lookupActive && registryFields
      ? {
          fieldCount: registryFields.length,
          areaHa: registryFields.reduce((sum, field) => sum + field.areaHa, 0),
        }
      : null
  const willImport = lookup !== null && lookup.fieldCount > 0
  const errors: FarmBasicsErrors = touched
    ? farmBasicsErrors(name, ownerName, cvr)
    : {}
  const hasErrors = Object.keys(errors).length > 0

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    setSubmitError(null)
    if (Object.keys(farmBasicsErrors(name, ownerName, cvr)).length > 0) return

    setIsSubmitting(true)
    try {
      const farm = await createFarm({
        name: name.trim(),
        ownerName: ownerName.trim(),
        cvr: cvr || null,
      })
      if (willImport && registryFields) {
        await importRegistryFields(
          farm.id,
          registryFields.map((field) => field.imkId),
        )
      }
      await mutate(farmsKey)
      navigate(`/farms/${farm.id}`)
    } catch {
      setSubmitError(
        'Kunne ikke oprette bedriften. Tjek felterne og prøv igen.',
      )
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <AppTopBar />
      <div className="mx-auto max-w-6xl px-6 pt-10 pb-20 sm:px-10">
        <Link
          to="/"
          state={HOME_OVERVIEW_STATE}
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Tilbage til bedrifter
        </Link>
        <div className="mt-5 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
          <form
            className="flex max-w-[560px] flex-col gap-9"
            onSubmit={onSubmit}
            noValidate
          >
            <div>
              <h1 className="font-display text-4xl leading-[1.1] tracking-tight">
                Opret en ny bedrift
              </h1>
              <p className="mt-3 text-[15px] leading-6 text-muted-foreground text-pretty">
                Et arbejdsområde for en bedrifts marker, planer og tal. Det
                tager under et minut, og marker kan hentes fra registret
                bagefter.
              </p>
            </div>

            <fieldset className="flex flex-col gap-[22px]">
              <legend className={cn(EYEBROW_CLASS, 'mb-[18px]')}>
                Grundoplysninger
              </legend>
              <FormField
                id="farm-name"
                label="Bedriftens navn"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                error={errors.name}
              />
              <FormField
                id="farm-owner-name"
                label="Ejerens navn"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                autoComplete="off"
                error={errors.ownerName}
              />
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className={cn(EYEBROW_CLASS, 'mb-[18px]')}>
                Registret{' '}
                <span className="font-normal tracking-normal normal-case">
                  · valgfrit
                </span>
              </legend>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2.5">
                  <div className="flex-1">
                    <FormField
                      id="farm-cvr"
                      label="CVR-nummer"
                      value={cvr}
                      onChange={(event) => {
                        setCvr(
                          event.target.value.replace(/\D/g, '').slice(0, 8),
                        )
                        setLookupCvr(null)
                      }}
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="8 cifre"
                      autoComplete="off"
                      className="tracking-[0.04em] tabular-nums"
                      error={errors.cvr}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!cvrComplete}
                    onClick={() => setLookupCvr(cvr)}
                    className="mt-7 h-[46px] rounded-xl px-4"
                  >
                    Slå op
                  </Button>
                </div>
                {lookupActive && lookupLoading ? (
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    Slår op i registret...
                  </p>
                ) : lookupActive && lookupError ? (
                  <p className="text-[13px] leading-5 text-red-700">
                    Opslaget i registret fejlede. Prøv igen.
                  </p>
                ) : willImport && lookup ? (
                  <div className="flex items-start gap-3 rounded-xl bg-primary/10 px-4 py-3.5 text-sm leading-5 text-primary-deep motion-safe:animate-rise-in">
                    <Check
                      className="mt-px size-[18px] shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div>
                      <strong className="font-semibold">
                        {lookup.fieldCount}{' '}
                        {lookup.fieldCount === 1 ? 'mark' : 'marker'}
                      </strong>{' '}
                      · {formatNumber(lookup.areaHa)} ha i registret
                      <br />
                      <span className="text-primary">
                        Markerne importeres, når bedriften oprettes.
                      </span>
                    </div>
                  </div>
                ) : lookup ? (
                  <p className="rounded-xl border border-dashed px-4 py-3 text-[13px] leading-5 text-muted-foreground">
                    Ingen marker fundet for dette CVR-nummer i registret.
                    Bedriften kan stadig oprettes uden marker.
                  </p>
                ) : errors.cvr ? null : (
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    Med et CVR-nummer kan bedriftens marker hentes direkte fra
                    markregistret, med areal, kystvandopland og udledningskvote.
                  </p>
                )}
              </div>
            </fieldset>

            <div className="flex flex-col gap-3.5 border-t pt-3.5">
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  disabled={isSubmitting}
                  className="h-[46px] rounded-full px-[22px] text-[15px] font-semibold"
                >
                  {isSubmitting
                    ? 'Opretter...'
                    : willImport
                      ? 'Opret bedrift og importer marker'
                      : 'Opret bedrift'}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  type="button"
                  className="h-[46px] rounded-full px-[18px] text-[15px] text-muted-foreground"
                >
                  <Link to="/" state={HOME_OVERVIEW_STATE}>
                    Annuller
                  </Link>
                </Button>
              </div>
              {hasErrors ? (
                <p className="text-[13px] text-red-700">
                  Udfyld de markerede felter for at fortsætte.
                </p>
              ) : null}
              {submitError ? (
                <p className="text-[13px] text-red-700">{submitError}</p>
              ) : null}
            </div>
          </form>

          <CreateFarmPreview
            name={name}
            ownerName={ownerName}
            cvr={cvr}
            lookup={lookup}
          />
        </div>
      </div>
    </main>
  )
}

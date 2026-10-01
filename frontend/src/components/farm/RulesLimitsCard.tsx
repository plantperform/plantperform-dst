import { AlertTriangle, Check, Pencil } from 'lucide-react'
import { useId } from 'react'

import type { FieldRecord } from '@/api/types'
import {
  catchmentKey,
  inputToOptionalNumber,
  numberToInput,
} from '@/components/farm/catchment-options'
import { CropAreaLimits } from '@/components/farm/CropAreaLimits'
import type { RulesLimits } from '@/components/farm/rules-limits-state'
import {
  FieldLabel,
  LimitsColumn,
  LimitValue,
  RULES_CARD_CLASS,
  RULES_CARD_HEAD_CLASS,
  RulesHint,
  SummaryList,
  SummaryRow,
  UnitInput,
  UnsavedDot,
} from '@/components/farm/rules-ui'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatNumber } from '@/lib/field-domain'

const limitAmount = (value: number | null) =>
  value === null ? null : formatNumber(value)

type RulesLimitsCardProps = {
  limits: RulesLimits
  fields: FieldRecord[]
}

export const RulesLimitsCard = ({ limits, fields }: RulesLimitsCardProps) => {
  const id = useId()
  const {
    catchments,
    quotaByKey,
    totalAreaHa,
    cropCodes,
    cropAreaRanges,
    cropAreaViolations,
    savedCropAreaLimits,
    editing,
    setEditing,
    cropPickerOpen,
    setCropPickerOpen,
    minFeedUnits,
    maxFeedUnits,
    maxNLoadInputs,
    cropInputs,
    showCropAreaErrors,
    saveState,
    maxNLoadByCatchment,
    nLoadChangedKeys,
    minFeedUnitsChanged,
    maxFeedUnitsChanged,
    changedSectionsLabel,
    isDirty,
    isSaving,
    canDiscard,
    editMaxNLoadInput,
    editMinFeedUnits,
    editMaxFeedUnits,
    editCropInputs,
    discard,
    save,
  } = limits

  return (
    <section className={RULES_CARD_CLASS} aria-labelledby={`${id}-title`}>
      <div className={RULES_CARD_HEAD_CLASS}>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            Grænser for hele bedriften
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Bruges, når du vælger{' '}
            <b className="font-semibold text-foreground">
              Gennemsnit for perioden
            </b>{' '}
            i Optimér. Loft hvert år har egne indstillinger, der kun gælder den
            enkelte kørsel.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          {editing ? 'Luk redigering' : 'Rediger grænser'}
        </Button>
      </div>

      <div className="grid divide-y border-t @3xl:grid-cols-3 @3xl:divide-x @3xl:divide-y-0">
        <LimitsColumn title="Maks. udledning pr. opland" term="nLoad">
          {catchments.length === 0 ? (
            <p className="mt-1.5 py-2.5 text-[13px] text-muted-foreground">
              Ingen marker med et kystvandopland
            </p>
          ) : editing ? (
            <div className="flex flex-col gap-2.5 pt-2.5 pb-2">
              {catchments.map((catchment) => {
                const key = catchmentKey(catchment.catchmentId)
                const quota = quotaByKey.get(key)
                return (
                  <div key={key}>
                    <FieldLabel
                      htmlFor={`${id}-n-load-${key}`}
                      label={catchment.label}
                      hint={
                        quota === undefined
                          ? null
                          : `Kvote ${formatNumber(quota)}`
                      }
                    />
                    <UnitInput
                      id={`${id}-n-load-${key}`}
                      unit="kg N"
                      type="number"
                      min="0"
                      value={maxNLoadInputs[key] ?? ''}
                      placeholder="Ingen grænse"
                      onChange={(event) =>
                        editMaxNLoadInput(key, event.target.value)
                      }
                    />
                  </div>
                )
              })}
              <RulesHint>
                Feltet starter med oplandets kvote. Tomt felt betyder ingen
                grænse.
              </RulesHint>
            </div>
          ) : (
            <SummaryList>
              {maxNLoadByCatchment.map((cap, index) => {
                const key = catchmentKey(cap.catchmentId)
                const quota = quotaByKey.get(key)
                return (
                  <SummaryRow
                    key={key}
                    label={catchments[index].label}
                    note={
                      quota !== undefined && cap.maxNLoadKg !== quota
                        ? `Kvote ${formatNumber(quota)}`
                        : null
                    }
                    value={
                      <LimitValue
                        amount={limitAmount(cap.maxNLoadKg)}
                        unit="kg N"
                      />
                    }
                    changed={nLoadChangedKeys.has(key)}
                  />
                )
              })}
            </SummaryList>
          )}
        </LimitsColumn>

        <LimitsColumn title="Foderenheder" term="feedUnits">
          {editing ? (
            <div className="flex flex-col gap-2.5 pt-2.5 pb-2">
              <div>
                <FieldLabel
                  htmlFor={`${id}-min-feed-units`}
                  label="Min. foderenheder"
                />
                <UnitInput
                  id={`${id}-min-feed-units`}
                  unit="FE"
                  type="number"
                  min="0"
                  value={numberToInput(minFeedUnits)}
                  placeholder="Ingen grænse"
                  onChange={(event) =>
                    editMinFeedUnits(inputToOptionalNumber(event.target.value))
                  }
                />
              </div>
              <div>
                <FieldLabel
                  htmlFor={`${id}-max-feed-units`}
                  label="Maks. foderenheder"
                />
                <UnitInput
                  id={`${id}-max-feed-units`}
                  unit="FE"
                  type="number"
                  min="0"
                  value={numberToInput(maxFeedUnits)}
                  placeholder="Ingen grænse"
                  onChange={(event) =>
                    editMaxFeedUnits(inputToOptionalNumber(event.target.value))
                  }
                />
              </div>
              <RulesHint>
                Samlet for bedriften. Tomt betyder ingen grænse.
              </RulesHint>
            </div>
          ) : (
            <SummaryList>
              <SummaryRow
                label="Min."
                value={
                  <LimitValue amount={limitAmount(minFeedUnits)} unit="FE" />
                }
                changed={minFeedUnitsChanged}
              />
              <SummaryRow
                label="Maks."
                value={
                  <LimitValue amount={limitAmount(maxFeedUnits)} unit="FE" />
                }
                changed={maxFeedUnitsChanged}
              />
            </SummaryList>
          )}
        </LimitsColumn>

        <LimitsColumn title="Afgrøder">
          <CropAreaLimits
            inputs={cropInputs}
            savedLimits={savedCropAreaLimits}
            cropCodes={cropCodes}
            fields={fields}
            ranges={cropAreaRanges}
            totalAreaHa={totalAreaHa}
            violations={cropAreaViolations}
            showErrors={showCropAreaErrors}
            editing={editing}
            pickerOpen={cropPickerOpen}
            onPickerOpenChange={(open) => {
              if (open) setEditing(true)
              setCropPickerOpen(open)
            }}
            onChange={editCropInputs}
          />
        </LimitsColumn>
      </div>

      <div className="flex min-h-15 flex-wrap items-center gap-2.5 rounded-b-lg border-t bg-muted/30 px-5 py-3">
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2 text-[13px]"
        >
          {isSaving ? (
            <>
              <Spinner className="size-3.5 text-primary" />
              <span className="text-muted-foreground">Gemmer…</span>
            </>
          ) : saveState.kind === 'error' ? (
            <>
              <AlertTriangle
                className="size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="text-destructive">
                <b>Kunne ikke gemme.</b> {saveState.message}
              </span>
            </>
          ) : isDirty ? (
            <>
              <UnsavedDot />
              <span>
                Ikke gemte ændringer i <b>{changedSectionsLabel}</b>
              </span>
            </>
          ) : saveState.kind === 'saved' ? (
            <>
              <Check
                className="size-4 shrink-0 text-primary"
                strokeWidth={2.4}
                aria-hidden="true"
              />
              <span className="font-semibold text-primary">Gemt</span>
              <span className="text-muted-foreground">
                · bruges ved næste kørsel med Gennemsnit for perioden
              </span>
            </>
          ) : (
            <>
              <Check
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">
                Alle grænser er gemt.
              </span>
            </>
          )}
        </div>
        {canDiscard ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={discard}
          >
            Fortryd
          </Button>
        ) : null}
        {isDirty || isSaving ? (
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => void save()}
          >
            Gem grænser
          </Button>
        ) : null}
      </div>
    </section>
  )
}

import { Pencil } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { useFieldAliases } from '@/api/field-aliases'
import type { FieldRecord } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fieldAliasKey } from '@/lib/field-aliases'
import { fieldTitle } from '@/lib/field-domain'

type FieldNameEditorProps = {
  farmId: string
  field: FieldRecord
  simulationId?: string
}

export const FieldNameEditor = ({
  farmId,
  field,
  simulationId,
}: FieldNameEditorProps) => {
  const aliases = useFieldAliases()
  const alias = aliases.data?.[fieldAliasKey(field)] ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const inputId = useId()
  const helpId = `${inputId}-help`
  const errorId = `${inputId}-error`

  const cancel = () => {
    if (savingRef.current) return
    setEditing(false)
    setError(null)
  }

  const save = async (value: string | null) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await aliases.saveAlias(farmId, field.id, value, simulationId)
      setEditing(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Kunne ikke gemme markens alias. Prøv igen.',
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate font-display text-2xl tracking-tight @2xl:text-3xl">
          {fieldTitle({ ...field, alias })}
        </h2>
        {!editing ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="size-8 shrink-0 p-0 text-muted-foreground"
            aria-label="Rediger markens alias"
            disabled={aliases.data === undefined || Boolean(aliases.error)}
            onClick={() => {
              setDraft(alias ?? '')
              setError(null)
              setEditing(true)
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {alias !== null ? (
        <p className="text-xs text-muted-foreground">
          Originalt navn: {field.name}
        </p>
      ) : null}
      {aliases.error ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p role="alert">Kunne ikke hente dine markaliaser.</p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void aliases.mutate().catch(() => undefined)}
            loading={aliases.isValidating}
          >
            Prøv igen
          </Button>
        </div>
      ) : null}
      {editing ? (
        <form
          className="space-y-2 pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save(draft.trim() || null)
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              event.target instanceof HTMLInputElement &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              void save(draft.trim() || null)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }
          }}
        >
          <label htmlFor={inputId} className="text-sm font-medium">
            Dit alias
          </label>
          <Input
            id={inputId}
            autoFocus
            value={draft}
            placeholder={field.name}
            disabled={saving}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            aria-invalid={Boolean(error)}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p id={helpId} className="text-xs text-muted-foreground">
            Kun synligt for dig på tværs af bedrifter og simuleringer.
          </p>
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="xs" loading={saving}>
              {saving ? 'Gemmer...' : 'Gem'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={saving}
              onClick={cancel}
            >
              Annuller
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={saving || alias === null}
              onClick={() => void save(null)}
            >
              Brug originalt navn
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

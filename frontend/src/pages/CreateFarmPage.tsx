import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { farmsKey } from '@/api/hooks'
import { createFarm } from '@/api/mutations'
import { FarmBasicsFields } from '@/components/onboarding/FarmBasicsFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WorkspaceHeader } from '@/components/WorkspaceHeader'
import { validateFarmBasics } from '@/lib/farm-form'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'

const readPrefillValue = (
  prefill: unknown,
  key: 'name' | 'ownerName' | 'cvr',
) => {
  if (typeof prefill !== 'object' || prefill === null) return ''
  const value = (prefill as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export const CreateFarmPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state as { prefill?: unknown } | null)?.prefill
  const [name, setName] = useState(() => readPrefillValue(prefill, 'name'))
  const [ownerName, setOwnerName] = useState(() =>
    readPrefillValue(prefill, 'ownerName'),
  )
  const [cvr, setCvr] = useState(() => readPrefillValue(prefill, 'cvr'))
  const [udledningskvoteKgN, setUdledningskvoteKgN] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const basicsError = validateFarmBasics(name, ownerName, cvr)
    if (basicsError) {
      setError(basicsError)
      return
    }

    const trimmedQuota = udledningskvoteKgN.trim()
    const quota = trimmedQuota ? Number(trimmedQuota) : null
    if (quota !== null && (!Number.isFinite(quota) || quota < 0)) {
      setError('Udledningskvoten skal være et positivt tal eller nul.')
      return
    }

    setIsSubmitting(true)
    try {
      const farm = await createFarm({
        name: name.trim(),
        ownerName: ownerName.trim(),
        cvr: cvr.trim() || null,
        ...(quota === null ? {} : { udledningskvoteKgN: quota }),
      })
      await mutate(farmsKey)
      navigate(`/farms/${farm.id}`)
    } catch {
      setError('Kunne ikke oprette bedriften. Tjek felterne og prøv igen.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <WorkspaceHeader
        title="Opret bedrift"
        description="Et arbejdsområde for en bedrifts marker, planer og tal."
      />
      <div className="mx-auto max-w-xl px-6 pb-16 pt-10 sm:px-10">
        <form className="space-y-6" onSubmit={onSubmit}>
          <FarmBasicsFields
            name={name}
            ownerName={ownerName}
            cvr={cvr}
            onNameChange={setName}
            onOwnerNameChange={setOwnerName}
            onCvrChange={setCvr}
          />
          <div className="space-y-2">
            <Label htmlFor="quota">Udledningskvote (kg, valgfrit)</Label>
            <Input
              id="quota"
              type="number"
              min="0"
              step="0.1"
              value={udledningskvoteKgN}
              onChange={(event) => setUdledningskvoteKgN(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Kan udfyldes senere ud fra markernes kvoter.
            </p>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button disabled={isSubmitting}>
              {isSubmitting ? 'Opretter...' : 'Opret bedrift'}
            </Button>
            <Button asChild variant="outline" type="button">
              <Link to="/" state={HOME_OVERVIEW_STATE}>
                Annuller
              </Link>
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}

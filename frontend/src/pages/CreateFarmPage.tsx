import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { createFarm } from '@/api/mutations'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const CreateFarmPage = () => {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [cvr, setCvr] = useState('')
  const [nitrogenQuotaKg, setNitrogenQuotaKg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!name.trim() || !ownerName.trim()) {
      setError('Bedriftens navn og ejerens navn skal udfyldes.')
      return
    }

    if (cvr.trim() && !/^\d{8}$/.test(cvr.trim())) {
      setError('CVR skal være præcis 8 cifre, hvis det udfyldes.')
      return
    }

    const trimmedQuota = nitrogenQuotaKg.trim()
    const quota = trimmedQuota ? Number(trimmedQuota) : null
    if (quota !== null && (!Number.isFinite(quota) || quota < 0)) {
      setError('Kvælstofkvoten skal være et positivt tal eller nul.')
      return
    }

    setIsSubmitting(true)
    try {
      const farm = await createFarm({
        name: name.trim(),
        ownerName: ownerName.trim(),
        cvr: cvr.trim() || null,
        ...(quota === null ? {} : { nitrogenQuotaKg: quota }),
      })
      await mutate('/farms')
      navigate(`/farms/${farm.id}`)
    } catch {
      setError('Kunne ikke oprette bedriften. Tjek felterne og prøv igen.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Opret bedrift</CardTitle>
            <CardDescription>
              Definer et planlægningsområde. CVR er valgfrit og kan senere
              bruges til at importere marker.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="name">Bedriftens navn</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerName">Ejerens navn</Label>
                <Input
                  id="ownerName"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cvr">CVR-nummer (valgfrit)</Label>
                <Input
                  id="cvr"
                  inputMode="numeric"
                  value={cvr}
                  onChange={(event) => setCvr(event.target.value)}
                  placeholder="10000001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quota">Kvælstofkvote (kg, valgfrit)</Label>
                <Input
                  id="quota"
                  type="number"
                  min="0"
                  step="0.1"
                  value={nitrogenQuotaKg}
                  onChange={(event) => setNitrogenQuotaKg(event.target.value)}
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
                  <Link to="/">Annuller</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

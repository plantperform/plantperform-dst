import { Copy, Eye } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { mutate } from 'swr'

import { duplicateFarm } from '@/api/farm-copy'
import { farmsKey } from '@/api/hooks'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'

export const FarmReadOnlyNotice = ({ farmId }: { farmId: string }) => {
  const navigate = useNavigate()
  const { showToast, showError } = useToast()
  const [copying, setCopying] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())

  const copy = async () => {
    setCopying(true)
    try {
      const copied = await duplicateFarm(farmId, requestId)
      await mutate(farmsKey)
      showToast(`${copied.name} er oprettet`)
      navigate(`/farms/${copied.id}`)
    } catch {
      showError('Kunne ikke lave en kopi af bedriften. Prøv igen.')
    }
    setCopying(false)
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-primary/15 bg-secondary px-6 py-3 text-sm"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Eye className="size-4" />
      </span>
      <p className="min-w-0">
        <span className="font-semibold text-secondary-foreground">
          Du kan kun se denne bedrift.
        </span>{' '}
        <span className="text-muted-foreground">
          Du er læser. Lav en kopi, hvis du vil ændre noget.
        </span>
      </p>
      <Button size="sm" loading={copying} onClick={() => void copy()}>
        {copying ? null : <Copy className="size-4" aria-hidden="true" />}
        Lav en kopi
      </Button>
    </div>
  )
}

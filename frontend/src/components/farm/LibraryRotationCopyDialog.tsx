import { Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useLibraryRotationDefinitions } from '@/api/own-rotations'
import type { RotationDefinition } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Pending } from '@/components/ui/pending'
import {
  copyableLibraryRotationsOf,
  definitionCropNames,
  describeYearCount,
} from '@/lib/own-rotations'
import { cropSequenceText } from '@/lib/rotation-overview'

type LibraryRotationCopyDialogProps = {
  cropNames: Map<number, string>
  copyingId: string | null
  onCopy: (definition: RotationDefinition) => Promise<boolean>
  trigger?: ReactNode
}

export const LibraryRotationCopyDialog = ({
  cropNames,
  copyingId,
  onCopy,
  trigger,
}: LibraryRotationCopyDialogProps) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const definitions = useLibraryRotationDefinitions(open)
  const library = copyableLibraryRotationsOf(definitions.data ?? []).map(
    (definition) => ({
      definition,
      crops: cropSequenceText(definitionCropNames(definition, cropNames)),
    }),
  )
  const search = query.trim().toLocaleLowerCase('da')
  const shown = library.filter(
    ({ definition, crops }) =>
      search === '' ||
      `${definition.name} ${crops}`.toLocaleLowerCase('da').includes(search),
  )

  const copy = async (definition: RotationDefinition) => {
    if (await onCopy(definition)) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Copy aria-hidden="true" />
            Kopier fra biblioteket
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kopier et sædskifte fra biblioteket</DialogTitle>
          <DialogDescription>
            Du kan kopiere de sædskifter fra biblioteket, der er valgt i en
            simulering på en af dine bedrifter. Kopien bliver dit eget
            sædskifte, som du kan rette i.
          </DialogDescription>
        </DialogHeader>
        {definitions.data === undefined ? (
          <Pending
            failed={Boolean(definitions.error)}
            failure="Sædskifterne kunne ikke hentes."
            loading="Henter sædskifterne..."
            retrying={definitions.isValidating}
            onRetry={() => void definitions.mutate()}
          />
        ) : library.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ingen af dine simuleringer har valgt sædskifter fra biblioteket
            endnu.
          </p>
        ) : (
          <div className="min-w-0 space-y-3">
            <Input
              type="search"
              aria-label="Søg sædskifte"
              placeholder="Søg på afgrøde eller nummer..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {shown.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Ingen sædskifter matcher søgningen.
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
                {shown.map(({ definition, crops }) => (
                  <li
                    key={definition.id}
                    className="flex items-start gap-3 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{definition.name}</p>
                      <p className="text-xs break-words text-muted-foreground">
                        {crops}
                      </p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                      {describeYearCount(
                        definition.variants[0]?.positions.length ?? 0,
                      )}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      loading={copyingId === definition.id}
                      disabled={copyingId !== null}
                      aria-label={`Kopier ${definition.name}`}
                      onClick={() => void copy(definition)}
                    >
                      Kopier
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

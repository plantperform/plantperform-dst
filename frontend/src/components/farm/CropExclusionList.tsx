import { useScenarioCropCodes } from '@/api/hooks'
import { Label } from '@/components/ui/label'

export const CropExclusionList = ({
  farmId,
  simulationId,
  excludedCodes,
  onToggle,
}: {
  farmId: string
  simulationId: string
  excludedCodes: Set<number>
  onToggle: (code: number) => void
}) => {
  const { data: crops = [] } = useScenarioCropCodes(farmId, simulationId)
  if (crops.length === 0) return null

  return (
    <div className="space-y-2">
      <Label>Afgrøder</Label>
      <p className="text-xs text-muted-foreground">
        Fravælg en afgrøde for at udelukke alle sædskifter, der indeholder den
        et eller flere steder. Valget gælder kun denne kørsel.
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {crops.map((crop) => (
          <label
            key={crop.code}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!excludedCodes.has(crop.code)}
              onChange={() => onToggle(crop.code)}
            />
            <span>{crop.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type FarmBasicsFieldsProps = {
  name: string
  ownerName: string
  cvr: string
  onNameChange: (value: string) => void
  onOwnerNameChange: (value: string) => void
  onCvrChange: (value: string) => void
}

export const FarmBasicsFields = ({
  name,
  ownerName,
  cvr,
  onNameChange,
  onOwnerNameChange,
  onCvrChange,
}: FarmBasicsFieldsProps) => (
  <>
    <div className="space-y-2">
      <Label htmlFor="farm-name">Bedriftens navn</Label>
      <Input
        id="farm-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="farm-owner-name">Ejerens navn</Label>
      <Input
        id="farm-owner-name"
        value={ownerName}
        onChange={(event) => onOwnerNameChange(event.target.value)}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="farm-cvr">CVR-nummer (valgfrit)</Label>
      <Input
        id="farm-cvr"
        inputMode="numeric"
        value={cvr}
        onChange={(event) => onCvrChange(event.target.value)}
        placeholder="10000001"
      />
      <p className="text-xs text-muted-foreground">
        Kan senere bruges til at importere marker fra registret.
      </p>
    </div>
  </>
)

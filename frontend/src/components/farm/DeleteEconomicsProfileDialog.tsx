import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatNameList } from '@/lib/economics'
import {
  deleteProfileMessage,
  STANDARD_PROFILE,
  type EconomicsProfile,
} from '@/lib/economics-profiles'

type DeleteEconomicsProfileDialogProps = {
  profile: EconomicsProfile | null
  simulationNames: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: (profileId: string) => void
}

export const DeleteEconomicsProfileDialog = ({
  profile,
  simulationNames,
  onOpenChange,
  onConfirm,
}: DeleteEconomicsProfileDialogProps) => (
  <Dialog open={profile !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Slet {profile?.name}?</DialogTitle>
        <DialogDescription>
          {deleteProfileMessage(simulationNames.length)}
        </DialogDescription>
      </DialogHeader>
      {simulationNames.length > 0 ? (
        <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          Bruges af{' '}
          <span className="font-semibold text-foreground">
            {formatNameList(simulationNames)}
          </span>
          , som går tilbage til {STANDARD_PROFILE.name}.
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuller</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button
            variant="destructive"
            onClick={() => {
              if (profile) onConfirm(profile.id)
            }}
          >
            Slet profil
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

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
import {
  deleteProfileMessage,
  type EconomicsProfile,
} from '@/lib/economics-profiles'

type DeleteEconomicsProfileDialogProps = {
  profile: EconomicsProfile | null
  simulationCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: (profileId: string) => void
}

export const DeleteEconomicsProfileDialog = ({
  profile,
  simulationCount,
  onOpenChange,
  onConfirm,
}: DeleteEconomicsProfileDialogProps) => (
  <Dialog open={profile !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Slet {profile?.name}?</DialogTitle>
        <DialogDescription>
          {deleteProfileMessage(simulationCount)}
        </DialogDescription>
      </DialogHeader>
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

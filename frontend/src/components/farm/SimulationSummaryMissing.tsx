import { Button } from '@/components/ui/button'

export const SimulationSummaryMissing = ({
  onOpenSettings,
}: {
  onOpenSettings?: () => void
}) => (
  <div
    role="status"
    className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm"
  >
    <p>Simuleringens oversigt mangler. Kør en optimering for at oprette den.</p>
    {onOpenSettings ? (
      <Button variant="outline" size="sm" onClick={onOpenSettings}>
        Åbn indstillinger
      </Button>
    ) : null}
  </div>
)

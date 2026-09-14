import { AppTopBar } from '@/components/AppTopBar'

type WorkspaceHeaderProps = {
  title: string
  description: string
}

export const WorkspaceHeader = ({
  title,
  description,
}: WorkspaceHeaderProps) => (
  <>
    <AppTopBar />
    <div className="mx-auto max-w-6xl px-6 pt-10 sm:px-10">
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  </>
)

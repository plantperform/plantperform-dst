import type { ReactNode } from 'react'

type EconomicsBannerProps = {
  label: string
  title: string
  text: string
  children: ReactNode
}

export const EconomicsBanner = ({
  label,
  title,
  text,
  children,
}: EconomicsBannerProps) => (
  <section
    aria-label={label}
    className="flex flex-wrap items-center gap-3.5 rounded-lg border bg-card px-3.5 py-3 shadow-sm"
  >
    <div className="min-w-0 flex-1 basis-80">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-[13px] text-muted-foreground">{text}</p>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
  </section>
)

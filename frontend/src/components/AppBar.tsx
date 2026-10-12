import { ChevronRight } from 'lucide-react'
import { Children, Fragment, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

import { AccountButton } from '@/components/AccountButton'
import { BrandIcon } from '@/components/BrandMark'
import { HOME_OVERVIEW_STATE } from '@/lib/onboarding'
import { cn } from '@/lib/utils'

const FOCUS_CLASS =
  'rounded-sm focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:outline-none'

const Separator = () => (
  <ChevronRight className="size-4 shrink-0 opacity-50" aria-hidden="true" />
)

export const AppBarCurrent = ({ children }: { children: ReactNode }) => (
  <span aria-current="page" className="truncate text-sm font-bold">
    {children}
  </span>
)

type AppBarProps = {
  children?: ReactNode
  steps?: string[]
  activeStep?: number
}

export const AppBar = ({ children, steps, activeStep = 0 }: AppBarProps) => (
  <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 bg-brand pr-4 pl-5 text-brand-foreground">
    <Link
      to="/"
      state={HOME_OVERVIEW_STATE}
      aria-label="PlantPerform, Dine bedrifter"
      className={cn('flex shrink-0 items-center gap-[9px]', FOCUS_CLASS)}
    >
      <BrandIcon onDark className="size-[30px] rounded-lg" />
      <span className="hidden text-[17px] font-bold sm:inline">
        PlantPerform
      </span>
    </Link>
    <nav aria-label="Hvor du er" className="flex min-w-0 items-center gap-3">
      <Separator />
      <NavLink
        to="/"
        end
        state={HOME_OVERVIEW_STATE}
        className={({ isActive }) =>
          cn(
            'truncate text-sm',
            isActive
              ? 'font-bold'
              : 'opacity-85 underline-offset-[3px] hover:underline hover:opacity-100',
            FOCUS_CLASS,
          )
        }
      >
        Dine bedrifter
      </NavLink>
      {Children.toArray(children).map((crumb, index) => (
        <Fragment key={index}>
          <Separator />
          {crumb}
        </Fragment>
      ))}
    </nav>
    {steps ? (
      <ol className="hidden min-w-0 flex-1 justify-center gap-6 px-6 text-sm md:flex">
        {steps.map((step, index) => {
          const active = index === activeStep
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'whitespace-nowrap',
                active ? 'font-bold' : 'opacity-75',
              )}
            >
              {index + 1} {step}
            </li>
          )
        })}
      </ol>
    ) : null}
    <AccountButton />
  </header>
)

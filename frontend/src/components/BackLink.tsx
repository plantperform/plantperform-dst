import { ChevronLeft } from 'lucide-react'
import { Link, type LinkProps } from 'react-router-dom'

import { cn } from '@/lib/utils'

const BACK_LINK_CLASS =
  'flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-[3px] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export const BackLink = ({ className, children, ...linkProps }: LinkProps) => (
  <Link {...linkProps} className={cn(BACK_LINK_CLASS, className)}>
    <ChevronLeft className="size-4" aria-hidden="true" />
    {children}
  </Link>
)

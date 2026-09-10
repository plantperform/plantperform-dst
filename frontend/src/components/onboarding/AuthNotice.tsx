import { CircleAlert, MailCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type AuthNoticeProps = {
  tone: 'success' | 'error'
  children: ReactNode
  className?: string
}

export const AuthNotice = ({ tone, children, className }: AuthNoticeProps) =>
  tone === 'error' ? (
    <p
      role="alert"
      className={cn('flex items-start gap-2 text-sm text-red-700', className)}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  ) : (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary',
        className,
      )}
    >
      <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )

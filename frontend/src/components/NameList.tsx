import { Fragment, type ReactNode } from 'react'

import { nameListFormat } from '@/lib/economics'

type NameListProps = {
  items: string[]
  renderItem: (item: string) => ReactNode
}

export const NameList = ({ items, renderItem }: NameListProps) => (
  <>
    {nameListFormat.formatToParts(items).map((part, index) => (
      <Fragment key={index}>
        {part.type === 'element' ? renderItem(part.value) : part.value}
      </Fragment>
    ))}
  </>
)

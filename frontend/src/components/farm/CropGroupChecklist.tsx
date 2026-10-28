import { CropGroupTile } from '@/components/farm/CropGroupTile'
import { groupCrops } from '@/lib/crop-groups'
import { cropLabel } from '@/lib/crop-label'
import { groupSelection, toggleGroup, toggleValue } from '@/lib/simulation-form'

export type CropChecklistItem = {
  // Identifies the crop in `selected`.
  key: string
  code?: number
  name: string
}

type CropGroupChecklistProps = {
  label: string
  items: readonly CropChecklistItem[]
  selected: string[]
  onChange: (selected: string[]) => void
}

// One row per crop group: the group on the left, its crops in two columns on
// the right. Where the list is too narrow for that, the group sits above its
// crops. The layout follows the width of the list, not of the window, because
// the dialog is narrower than the window. The group's own checkbox selects or
// clears every crop in it, and shows a dash while only some are selected.
export const CropGroupChecklist = ({
  label,
  items,
  selected,
  onChange,
}: CropGroupChecklistProps) => (
  <ul aria-label={label} className="@container">
    {groupCrops(items).map(({ group, crops }) => {
      const keys = crops.map((crop) => crop.key)
      const selection = groupSelection(selected, keys)
      return (
        <li
          key={group.id}
          className="grid gap-x-3 gap-y-1.5 border-t py-2 first:border-t-0 first:pt-0 last:pb-0 @lg:grid-cols-[10.5rem_minmax(0,1fr)]"
        >
          <label className="flex cursor-pointer items-center gap-2 self-start text-sm leading-5 font-medium">
            <input
              type="checkbox"
              checked={selection === 'all'}
              ref={(input) => {
                if (input) input.indeterminate = selection === 'some'
              }}
              onChange={() => onChange(toggleGroup(selected, keys))}
            />
            <CropGroupTile group={group} />
            {group.label}
          </label>
          <ul
            aria-label={group.label}
            className="grid grid-cols-2 gap-x-4 gap-y-1 pl-6 @lg:pl-0"
          >
            {crops.map((crop) => (
              <li key={crop.key}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(crop.key)}
                    onChange={() => onChange(toggleValue(selected, crop.key))}
                  />
                  {cropLabel(crop.code, crop.name)}
                </label>
              </li>
            ))}
          </ul>
        </li>
      )
    })}
  </ul>
)

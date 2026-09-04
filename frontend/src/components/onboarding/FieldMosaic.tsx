import { cn } from '@/lib/utils'

type MosaicVariant = 'panel' | 'band'

type Parcel = { points: string; fill: string; opacity: number }

const PANEL_PARCELS: Parcel[] = [
  { points: '0,6 76,10 72,60 0,55', fill: '#c9973f', opacity: 0.82 },
  { points: '76,10 150,2 155,58 72,60', fill: '#a7c69b', opacity: 0.68 },
  { points: '150,2 230,9 224,62 155,58', fill: '#c9b27f', opacity: 0.75 },
  { points: '230,9 305,4 312,59 224,62', fill: '#7fb5a8', opacity: 0.5 },
  { points: '305,4 400,11 400,62 312,59', fill: '#a7c69b', opacity: 0.55 },
  { points: '0,55 72,60 68,120 0,120', fill: '#7fb5a8', opacity: 0.42 },
  { points: '72,60 155,58 160,120 68,120', fill: '#c9b27f', opacity: 0.85 },
  { points: '155,58 224,62 218,120 160,120', fill: '#a7c69b', opacity: 0.48 },
  { points: '224,62 312,58 300,120 218,120', fill: '#c9973f', opacity: 0.62 },
  { points: '312,58 400,62 400,120 300,120', fill: '#c9b27f', opacity: 0.45 },
]

const BAND_TOP: Array<[number, number]> = [
  [0, 6],
  [90, 2],
  [175, 9],
  [290, 4],
  [370, 10],
  [470, 3],
  [560, 8],
  [660, 5],
  [760, 10],
  [850, 2],
  [950, 7],
  [1040, 4],
  [1130, 9],
  [1200, 6],
]

const BAND_MID: Array<[number, number]> = [
  [0, 58],
  [80, 54],
  [185, 62],
  [275, 55],
  [380, 60],
  [460, 53],
  [575, 61],
  [650, 56],
  [770, 63],
  [840, 54],
  [960, 59],
  [1030, 55],
  [1140, 62],
  [1200, 57],
]

const BAND_BOTTOM = [
  0, 95, 170, 300, 360, 480, 550, 670, 750, 860, 940, 1050, 1120, 1200,
]

const BAND_FILLS_TOP = [
  '#c9973f',
  '#a7c69b',
  '#c9b27f',
  '#7fb5a8',
  '#a7c69b',
  '#c9973f',
  '#c9b27f',
  '#a7c69b',
  '#7fb5a8',
  '#c9b27f',
  '#a7c69b',
  '#c9973f',
  '#c9b27f',
]

const BAND_OPACITY_TOP = [
  0.62, 0.5, 0.7, 0.38, 0.45, 0.55, 0.42, 0.6, 0.3, 0.65, 0.4, 0.5, 0.45,
]

const BAND_FILLS_BOTTOM = [
  '#7fb5a8',
  '#c9b27f',
  '#a7c69b',
  '#c9973f',
  '#c9b27f',
  '#a7c69b',
  '#c9973f',
  '#c9b27f',
  '#a7c69b',
  '#7fb5a8',
  '#c9b27f',
  '#a7c69b',
  '#c9973f',
]

const BAND_OPACITY_BOTTOM = [
  0.3, 0.72, 0.4, 0.5, 0.35, 0.55, 0.4, 0.6, 0.35, 0.42, 0.55, 0.45, 0.58,
]

const BAND_PARCELS: Parcel[] = BAND_TOP.slice(0, -1).flatMap((_, index) => {
  const [tx1, ty1] = BAND_TOP[index]
  const [tx2, ty2] = BAND_TOP[index + 1]
  const [mx1, my1] = BAND_MID[index]
  const [mx2, my2] = BAND_MID[index + 1]
  const bx1 = BAND_BOTTOM[index]
  const bx2 = BAND_BOTTOM[index + 1]
  return [
    {
      points: `${tx1},${ty1} ${tx2},${ty2} ${mx2},${my2} ${mx1},${my1}`,
      fill: BAND_FILLS_TOP[index],
      opacity: BAND_OPACITY_TOP[index],
    },
    {
      points: `${mx1},${my1} ${mx2},${my2} ${bx2},120 ${bx1},120`,
      fill: BAND_FILLS_BOTTOM[index],
      opacity: BAND_OPACITY_BOTTOM[index],
    },
  ]
})

const VARIANT_CONFIG: Record<
  MosaicVariant,
  { viewBox: string; parcels: Parcel[]; delayStepMs: number }
> = {
  panel: { viewBox: '0 0 400 120', parcels: PANEL_PARCELS, delayStepMs: 70 },
  band: { viewBox: '0 0 1200 120', parcels: BAND_PARCELS, delayStepMs: 35 },
}

export const FieldMosaic = ({
  variant = 'panel',
  className,
}: {
  variant?: MosaicVariant
  className?: string
}) => {
  const { viewBox, parcels, delayStepMs } = VARIANT_CONFIG[variant]
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn(
        'block h-32 w-full [mask-image:linear-gradient(to_top,black_55%,transparent)]',
        className,
      )}
    >
      {parcels.map((parcel, index) => (
        <polygon
          key={parcel.points}
          points={parcel.points}
          fill={parcel.fill}
          fillOpacity={parcel.opacity}
          stroke="hsl(var(--primary-foreground) / 0.28)"
          strokeWidth="1"
          strokeLinejoin="round"
          className="motion-safe:animate-[mosaic-in_700ms_ease-out_both]"
          style={{ animationDelay: `${index * delayStepMs}ms` }}
        />
      ))}
    </svg>
  )
}

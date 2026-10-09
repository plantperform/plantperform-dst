import { cn } from '@/lib/utils'

const ORGANISATIONS = [
  {
    name: 'Novo Nordisk Foundation',
    src: '/logos/novo-nordisk-foundation.png',
    className: 'h-[78px]',
  },
  {
    name: 'Innovationscenter for Økologisk Landbrug',
    src: '/logos/icoel.png',
    className: 'w-[196px]',
  },
  {
    name: 'Aarhus Universitet, Institut for Agroøkologi',
    src: '/logos/aarhus-university.png',
    className: 'w-[208px]',
  },
  {
    name: 'SEGES Innovation',
    src: '/logos/seges-innovation.svg',
    className: 'w-[124px] max-w-[72%]',
  },
]

const TITLE_ID = 'organisation-logos-title'

export const OrganisationLogos = ({ className }: { className?: string }) => (
  <div className={cn('flex-col gap-3.5', className)}>
    <p
      id={TITLE_ID}
      className="text-[11px] tracking-[0.2em] text-brand-foreground/85 uppercase"
    >
      Udviklet i samarbejde med
    </p>
    <ul aria-labelledby={TITLE_ID} className="grid grid-cols-2 gap-2.5">
      {ORGANISATIONS.map((organisation) => (
        <li
          key={organisation.src}
          className="flex h-24 items-center justify-center rounded-[10px] bg-background px-3"
        >
          <img
            src={organisation.src}
            alt={organisation.name}
            className={cn('max-w-full', organisation.className)}
          />
        </li>
      ))}
    </ul>
  </div>
)

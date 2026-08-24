import { useState } from 'react'

import type { RotationCandidateYearResult } from '@/api/types'
import {
  L_FORMULA_CONSTANTS,
  M_LABELS,
  M_P,
  MP_LABELS,
  MP_P,
  NTHETA_COEFFICIENTS,
  W_LABELS,
  W_P,
  WP_LABELS,
  WP_P,
} from '@/lib/nles5-detail-labels'

const num = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value ?? 0)

const fmt = (value: unknown, digits = 2) =>
  new Intl.NumberFormat('da-DK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(num(value))

const fmtSigned = (value: unknown, digits = 3) => {
  const n = num(value)
  return `${n >= 0 ? '+' : ''}${fmt(n, digits)}`
}

type Row = { label: string; detail?: string; value: string; strong?: boolean }

const DetailTable = ({ rows }: { rows: Row[] }) => (
  <table className="w-full border-collapse text-xs">
    <tbody>
      {rows.map((row, index) => (
        <tr key={index} className="border-t first:border-t-0">
          <td className="py-1.5 pr-2 align-top text-muted-foreground">
            {row.label}
          </td>
          {row.detail !== undefined ? (
            <td className="py-1.5 pr-2 align-top text-muted-foreground">
              {row.detail}
            </td>
          ) : null}
          <td
            className={`py-1.5 text-right align-top tabular-nums ${row.strong ? 'font-semibold' : ''}`}
          >
            {row.value}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
    {children}
  </div>
)

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </h4>
)

const MetricTile = ({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption?: string
}) => (
  <div className="rounded-md border bg-background p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    {caption ? (
      <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
    ) : null}
  </div>
)

// Nøgletal-laget — samme metrics som den gamle app viste pr. år (Normudbytte,
// Forfrugt FV, Tildelt N) plus DB og foderenheder, som DST2 allerede beregner
// men ikke tidligere samlede ét sted. Det fulde formel-gennemgang (M/W/MP/WP,
// Nθ, L_nuar, DB2-poster) er lag 2, foldet ud herfra, ikke vist som standard.
const KeyMetricsSection = ({
  year,
  areaHa,
}: {
  year: RotationCandidateYearResult
  areaHa: number
}) => {
  const udbytte = num(year.dbDetail.udbytte)
  const udbytteenhed = String(year.dbDetail.udbytteenhed ?? '')
  const isFoderafgroede = udbytteenhed === 'FE/ha'
  const forfrugt = year.forfrugtsvaerdiKgnHa
  // Husdyrgødning har to dele: en udnyttet/mineralsk del, der tæller med i
  // normopfyldelsen ligesom handelsgødning, og en organisk bundet del, der
  // ikke gør (men stadig indgår i selve udvaskningsberegningen som G0).
  const husdyrUdnyttet = year.tildeltHusdyrgodningUdnyttetKgnHa
  const handelsgodning = year.tildeltHandelsgodningKgnHa
  const organiskBundet = year.husdyrgodningOrganiskBundetKgnHa
  const tildeltGoedning = husdyrUdnyttet + handelsgodning
  const tilgaengeligtN = forfrugt + tildeltGoedning

  const afgrodeNorm = year.afgrodeNormKgnHa
  const reduceretNorm = afgrodeNorm !== null ? afgrodeNorm * (year.nNormPct / 100) : null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <MetricTile
        label="Afgrøde-norm"
        value={afgrodeNorm !== null ? `${fmt(afgrodeNorm, 0)} kg N/ha` : '—'}
        caption={
          reduceretNorm !== null
            ? `${fmt(year.nNormPct, 0)}% gødet til norm = ${fmt(reduceretNorm, 0)} kg N/ha`
            : undefined
        }
      />
      <MetricTile label="Normudbytte" value={udbytte ? `${fmt(udbytte, 0)} ${udbytteenhed}` : '—'} />
      <MetricTile
        label="Foderenheder"
        value={isFoderafgroede ? `${fmt(udbytte, 0)} FE/ha` : '—'}
      />
      <MetricTile label="Forfrugtsværdi" value={`${fmt(forfrugt, 0)} kg N/ha`} />
      <MetricTile
        label="Tildelt gødning"
        value={`${fmt(tildeltGoedning, 0)} kg N/ha`}
        caption={
          `Husdyrgødning (udnyttet) ${fmt(husdyrUdnyttet, 0)} + handelsgødning ${fmt(handelsgodning, 0)}` +
          (organiskBundet > 0
            ? ` — plus ${fmt(organiskBundet, 0)} kg N/ha organisk bundet fra den udlagte gødning (tæller ikke med i normen; regnes af den fulde gødningsmængde, ikke kun det denne afgrøde kunne bruge — de to tal summer derfor bevidst ikke til gødningens fulde totale N-indhold)`
            : '')
        }
      />
      <MetricTile label="DB" value={`${fmt(year.dbKrHa, 0)} kr/ha`} />
      <MetricTile
        label="Tilgængeligt N"
        value={`${fmt(tilgaengeligtN, 0)} kg N/ha`}
        caption={`Forfrugt ${fmt(forfrugt, 0)} + husdyrgødning ${fmt(husdyrUdnyttet, 0)} + handelsgødning ${fmt(handelsgodning, 0)}`}
      />
      <MetricTile
        label="Ton gødning"
        value={`${fmt(year.husdyrgodningTonPrHa * areaHa, 1)} ton`}
        caption={`${fmt(year.husdyrgodningTonPrHa, 2)} ton/ha — reference, indgår senere i optimeringen`}
      />
    </div>
  )
}

const LeachingDetailSection = ({
  detail,
}: {
  detail: Record<string, unknown>
}) => {
  const m = num(detail.M)
  const wUsed = num(detail.W_used ?? detail.W)
  const wRef = detail.W_ref
  const mp = num(detail.MP)
  const wp = num(detail.WP)
  const wc = num(detail.WC)

  const mCoef = M_P[m] ?? 0
  const wCoef = W_P[wUsed] ?? 0
  const mpCoef = MP_P[mp] ?? 0
  const wpCoef = WP_P[wp] ?? 0
  const cTotal = mCoef + wCoef + mpCoef + wpCoef

  const { bt, bCS, bCA, budb, bm1M, bf0, bf1, bg0, bm1G, theta2 } =
    NTHETA_COEFFICIENTS
  const nt = num(detail.NT)
  const mncs = num(detail.MNCS)
  const mnca = num(detail.MNCA)
  const mnudb = num(detail.MNudb)
  const m1 = num(detail.M1)
  const m2 = num(detail.M2)
  const f0 = num(detail.F0)
  const f1 = num(detail.F1)
  const f2 = num(detail.F2)
  const g0 = num(detail.G0)
  const g1 = num(detail.G1)
  const g2 = num(detail.G2)

  const tNT = bt * nt
  const tMNCS = bCS * mncs
  const tMNCA = bCA * mnca
  const tUdb = budb * mnudb
  const tMHist = bm1M * ((m1 + m2) / 2)
  const tF0 = bf0 * f0
  const tFHist = bf1 * ((f1 + f2) / 2)
  const tG0 = bg0 * g0
  const tGHist = bm1G * ((g1 + g2) / 2)
  const nRaw = tNT + tMNCS + tMNCA + tUdb + tMHist + tF0 + tFHist + tG0 + tGHist
  const ntheta = num(detail.Ntheta)

  const p = num(detail.P)
  const s = num(detail.S)
  const y = num(detail.Y) || 2024
  const { tau, mu, kappa, rho } = L_FORMULA_CONSTANTS
  const trend = tau * (y - 1991)
  const base = mu + ntheta + num(detail.C)
  const ps = p * s
  const cropSoil = base ** kappa * ps ** rho
  const lRaw = Math.max(0, trend + cropSoil)
  const l = num(detail.L)
  const lNuar = num(detail.L_nuar)

  const m11Applied = Boolean(detail.M11_korrektion_anvendt)
  const eeaRed = num(detail.EEA) * num(detail.Fdato_factor)
  const virksum = eeaRed + num(detail.EMA) + num(detail.ETS)
  const faktor1 = 1 - virksum
  const faktor2 = 1 - num(detail.EPJ)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionHeading>Afgrødekoder</SectionHeading>
        <DetailTable
          rows={[
            {
              label: `M=${m}`,
              detail: `Hovedafgrøde — ${M_LABELS[m] ?? '—'}`,
              value: fmtSigned(mCoef),
            },
            {
              label: `W=${wUsed}`,
              detail: `Vinterdækning${wRef !== null && wRef !== undefined ? ` (EEA-ref, oprindelig W${detail.W_original})` : ''} — ${W_LABELS[wUsed] ?? '—'}`,
              value: fmtSigned(wCoef),
            },
            {
              label: `MP=${mp}`,
              detail: `Forfrugt — ${MP_LABELS[mp] ?? '—'}`,
              value: fmtSigned(mpCoef),
            },
            {
              label: `WP=${wp}`,
              detail: `Forfrugtens vinterdækning — ${WP_LABELS[wp] ?? '—'}`,
              value: fmtSigned(wpCoef),
            },
            {
              label: `WC=${wc}`,
              detail:
                wc === 1
                  ? 'Efterårsoptag — stort N-optag (ingen korrektion)'
                  : `Efterårsoptag — lavt N-optag (× θ₂=${theta2})`,
              value: '—',
            },
          ]}
        />
        <Callout>
          C = {fmtSigned(mCoef)} {fmtSigned(wCoef)} {fmtSigned(mpCoef)}{' '}
          {fmtSigned(wpCoef)} = <strong>{fmt(cTotal, 3)}</strong>
        </Callout>
      </div>

      <div className="space-y-1.5">
        <SectionHeading>Nθ — Kvælstoftilgængelighed</SectionHeading>
        <DetailTable
          rows={[
            { label: `β_t · NT`, detail: `${bt} × ${fmt(nt, 3)}`, value: fmt(tNT, 4) },
            { label: `β_CS · MNCS`, detail: `${bCS} × ${fmt(mncs, 1)}`, value: fmt(tMNCS, 4) },
            { label: `β_CA · MNCA`, detail: `${bCA} × ${fmt(mnca, 1)}`, value: fmt(tMNCA, 4) },
            { label: `β_udb · MNudb`, detail: `${budb} × ${fmt(mnudb, 1)}`, value: fmt(tUdb, 4) },
            {
              label: `β_m1 · (M1+M2)/2`,
              detail: `${bm1M} × (${fmt(m1, 1)}+${fmt(m2, 1)})/2`,
              value: fmt(tMHist, 4),
            },
            { label: `β_f0 · F0`, detail: `${bf0} × ${fmt(f0, 1)}`, value: fmt(tF0, 4) },
            {
              label: `β_f1 · (F1+F2)/2`,
              detail: `${bf1} × (${fmt(f1, 1)}+${fmt(f2, 1)})/2`,
              value: fmt(tFHist, 4),
            },
            { label: `β_g0 · G0`, detail: `${bg0} × ${fmt(g0, 1)}`, value: fmt(tG0, 4) },
            {
              label: `β_m1G · (G1+G2)/2`,
              detail: `${bm1G} × (${fmt(g1, 1)}+${fmt(g2, 1)})/2`,
              value: fmt(tGHist, 4),
            },
            { label: 'Sum', detail: '', value: fmt(nRaw, 4), strong: true },
          ]}
        />
        <Callout>
          Nθ = {fmt(nRaw, 4)}
          {wc === 2 ? ` × ${theta2} = ${fmt(nRaw * theta2, 4)}` : ''} ={' '}
          <strong>{fmt(ntheta, 4)}</strong>{' '}
          {wc === 2 ? `(× θ₂, WC=2)` : '(ingen WC-korrektion, WC=1)'}
        </Callout>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <SectionHeading>P — Perkolationsfaktor</SectionHeading>
          <p className="text-xs text-muted-foreground">
            Midlertidig fælles placeholder-værdi (afstrømningskategori 1),
            indtil rigtige per-mark-værdier findes.
          </p>
          <Callout>
            P = <strong>{fmt(p, 5)}</strong>
          </Callout>
        </div>
        <div className="space-y-1.5">
          <SectionHeading>S — Jordfaktor</SectionHeading>
          <p className="text-xs text-muted-foreground">
            Midlertidig fælles placeholder-værdi, indtil rigtige
            per-mark-værdier findes.
          </p>
          <Callout>
            S = <strong>{fmt(s, 5)}</strong>
          </Callout>
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionHeading>L — Rå NLES5-udvaskning</SectionHeading>
        <p className="font-mono text-xs text-muted-foreground">
          L = τ·(Y−1991) + (μ + Nθ + C)^κ · (P·S)^ρ
        </p>
        <DetailTable
          rows={[
            { label: 'Tidstrend τ·(Y−1991)', detail: `${tau}·(${y}−1991)`, value: fmt(trend, 4) },
            { label: 'μ + Nθ + C', detail: `${mu} + ${fmt(ntheta, 4)} + ${fmt(num(detail.C), 4)}`, value: fmt(base, 4) },
            { label: '(μ+Nθ+C)^κ', detail: `${fmt(base, 4)}^${kappa}`, value: fmt(base ** kappa, 4) },
            { label: 'P·S', detail: `${fmt(p, 5)}·${fmt(s, 5)}`, value: fmt(ps, 5) },
            { label: '(P·S)^ρ', detail: `${fmt(ps, 5)}^${rho}`, value: fmt(ps ** rho, 5) },
            {
              label: 'Afgrøde/jord-led',
              detail: `${fmt(base ** kappa, 4)}·${fmt(ps ** rho, 5)}`,
              value: fmt(cropSoil, 4),
            },
          ]}
        />
        <Callout>
          L (før evt. M11-korrektion) = {fmt(trend, 4)} + {fmt(cropSoil, 4)} ={' '}
          <strong>{fmt(lRaw, 3)} kg N/ha</strong>
        </Callout>
      </div>

      {m11Applied ? (
        <div className="space-y-1.5">
          <SectionHeading>
            M11-korrektion — majshelsæd efter græs/kløvergræs
          </SectionHeading>
          <p className="text-xs text-muted-foreground">
            Tabel-korrektionsfaktor baseret på tilført mineralsk N om foråret
            (MNCS), trin på 10 kg N/ha.
          </p>
          <DetailTable
            rows={[
              { label: 'MNCS (forår)', value: `${fmt(num(detail.M11_MNCS), 1)} kg N/ha` },
              { label: 'Korrektionsfaktor', value: fmt(num(detail.M11_korrektionsfaktor), 3), strong: true },
              { label: 'L (før korrektion)', value: `${fmt(lRaw, 3)} kg N/ha` },
              { label: 'L (efter korrektion)', value: `${fmt(l, 3)} kg N/ha`, strong: true },
            ]}
          />
          <Callout>
            L = {fmt(lRaw, 3)} × {fmt(num(detail.M11_korrektionsfaktor), 3)} ={' '}
            <strong>{fmt(l, 3)} kg N/ha</strong> (M11-korrektion anvendt)
          </Callout>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <SectionHeading>L_nuar — NUAR-justeret udvaskning</SectionHeading>
        <p className="font-mono text-xs text-muted-foreground">
          L_nuar = L · (1 − EEA·Fdato − EMA − ETS) · (1 − EPJ)
        </p>
        <DetailTable
          rows={[
            {
              label: 'Efterafgrøde',
              detail: `EEA=${fmt(num(detail.EEA), 2)} · Fdato=${fmt(num(detail.Fdato_factor), 3)}`,
              value: fmt(eeaRed, 4),
            },
            { label: 'Mellemafgrøde', detail: 'EMA', value: fmt(num(detail.EMA), 4) },
            { label: 'Tidlig såning', detail: 'ETS', value: fmt(num(detail.ETS), 4) },
            { label: 'Sum virkemidler', detail: '', value: fmt(virksum, 4) },
            { label: 'Faktor 1 (virkemidler)', detail: `1 − ${fmt(virksum, 4)}`, value: fmt(faktor1, 4) },
            { label: 'Faktor 2 (EPJ)', detail: `1 − ${fmt(num(detail.EPJ), 2)}`, value: fmt(faktor2, 4) },
          ]}
        />
        <Callout>
          L_nuar = {fmt(l, 3)} × {fmt(faktor1, 4)} × {fmt(faktor2, 4)} ={' '}
          <strong>{fmt(lNuar, 3)} kg N/ha</strong>
        </Callout>
        {detail.efterafgroede_nfiks ? (
          <p className="text-xs text-muted-foreground">
            §24 stk. 9: Efterafgrødeblanding med kvælstoffikserende arter — F0
            ovenfor inkluderer allerede +
            {fmt(num(detail.efterafgroede_nfiks_bonus), 0)} kg N herfra.
          </p>
        ) : null}
      </div>
    </div>
  )
}

const EconomicDetailSection = ({
  detail,
}: {
  detail: Record<string, unknown>
}) => {
  const udbytte = num(detail.udbytte)
  const enhed = String(detail.udbytteenhed ?? '')
  const salgspris = num(detail.salgspris)
  const indtaegt = num(detail.indtaegt)
  const tilskud = num(detail.tilskud)
  const goedning = num(detail.goedning)
  const udsaed = num(detail.udsaed)
  const plantevaern = num(detail.plantevaern)
  const markarbejde = num(detail.markarbejde)
  const toerring = num(detail.toerring)
  const omkostninger = num(detail.omkostninger_total)
  const db = num(detail.db)

  return (
    <div className="space-y-1.5">
      <SectionHeading>Dækningsbidrag (DB2)</SectionHeading>
      {detail.udbyttenorm_mangler ? (
        <p className="text-xs text-amber-700">
          Ingen udbyttenorm fundet for denne afgrøde/JB-nr — udbytte og
          indtægt er sat til 0.
        </p>
      ) : null}
      <DetailTable
        rows={[
          { label: 'Udbytte', value: `${fmt(udbytte, 1)} ${enhed}` },
          { label: 'Salgspris', value: `${fmt(salgspris, 2)} kr/${enhed || 'enhed'}` },
          { label: 'Indtægt', detail: 'udbytte × salgspris', value: `${fmt(indtaegt, 0)} kr/ha`, strong: true },
          { label: 'Tilskud', value: `+${fmt(tilskud, 0)} kr/ha` },
          { label: 'Gødning', value: `−${fmt(goedning, 0)} kr/ha` },
          { label: 'Udsæd', value: `−${fmt(udsaed, 0)} kr/ha` },
          { label: 'Planteværn', value: `−${fmt(plantevaern, 0)} kr/ha` },
          { label: 'Markarbejde', value: `−${fmt(markarbejde, 0)} kr/ha` },
          { label: 'Tørring/lagring', value: `−${fmt(toerring, 0)} kr/ha` },
          { label: 'Omkostninger i alt', value: `−${fmt(omkostninger, 0)} kr/ha`, strong: true },
        ]}
      />
      <Callout>
        DB2 = {fmt(indtaegt, 0)} + {fmt(tilskud, 0)} − {fmt(omkostninger, 0)} ={' '}
        <strong>{fmt(db, 0)} kr/ha</strong>
      </Callout>
    </div>
  )
}

type RotationYearsDetailProps = {
  years: RotationCandidateYearResult[]
  areaHa: number
}

export const RotationYearsDetail = ({ years, areaHa }: RotationYearsDetailProps) => {
  const [selectedYear, setSelectedYear] = useState(0)
  const [showFullDetail, setShowFullDetail] = useState(false)

  const year = years[Math.min(selectedYear, years.length - 1)]
  if (!year) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {years.map((y, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setSelectedYear(index)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              index === selectedYear
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted'
            }`}
          >
            År {index + 1} — {y.year.afgrodeNavn}
            {y.year.udlaegNavn ? ` (${y.year.udlaegNavn})` : ''}
          </button>
        ))}
      </div>

      <KeyMetricsSection year={year} areaHa={areaHa} />

      <button
        type="button"
        onClick={() => setShowFullDetail((current) => !current)}
        className="text-xs font-medium text-primary hover:underline"
      >
        {showFullDetail ? '▴ Skjul fuld beregningsgennemgang' : '▾ Vis fuld beregningsgennemgang'}
      </button>

      {showFullDetail ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <LeachingDetailSection detail={year.leachingDetail} />
          <EconomicDetailSection detail={year.dbDetail} />
        </div>
      ) : null}
    </div>
  )
}

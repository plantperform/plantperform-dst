// Koefficienter og labels til "Beregningsdetaljer pr. år" — porteret fra
// c:\plantperform-nles\streamlit_app.py (linje ~1250-1281), som igen afspejler
// NLES5-motorens Bilag 2-koefficienter (services/nles5/engine.py).

export const M_LABELS: Record<number, string> = {
  1: 'Vintersæd',
  2: 'Vårsæd (inkl. kartofler)',
  3: 'Bælgsæd-korn blanding',
  4: 'Græs og kløvergræs',
  5: 'Frøgræs',
  6: 'Brak',
  7: 'Sukkerroer, foderroer og hamp',
  8: 'Majshelsæd',
  9: 'Vinterraps',
  10: 'Vintersæd efter græs',
  11: 'Majshelsæd efter græs',
  12: 'Vårsæd efter græs',
  13: 'Bælgsæd og vårraps',
}

export const W_LABELS: Record<number, string> = {
  1: 'Vintersæd',
  2: 'Bar jord',
  3: 'Bar jord efter majs/kartofler',
  4: 'Efterafgrøder, undersået græs og brak',
  5: 'Ukrudt og spildkorn',
  6: 'Græs, kløvergræs, vinterraps, roer',
  7: 'Vintersæd efter græs',
  8: 'Græs og kløvergræs pløjet sent',
}

export const MP_LABELS: Record<number, string> = {
  1: 'Vintersæd',
  2: 'Andre afgrøder',
  3: 'Græs, kløvergræs, frøgræs og brak',
  4: 'Vår-/vinterafgrøder efter græs',
}

export const WP_LABELS: Record<number, string> = {
  1: 'Vintersæd',
  2: 'Bar jord og spildkorn',
  3: 'Græs og kløvergræs',
  4: 'Efterafgrøder',
  5: 'Frøgræs og brak',
  6: 'Sukkerroer, foderroer og hamp',
  7: 'Bar jord efter majs/kartofler',
  8: 'Vinterraps',
  9: 'Bar jord/vinsæd efter græs (forårspløjet)',
  10: 'Bar jord/vinsæd efter græs (efterårspløjet)',
}

export const M_P: Record<number, number> = {
  1: 0, 2: -6.744, 3: -7.279, 4: -13.493, 5: -17.478, 6: -11.192,
  8: -0.64, 9: 3.534, 10: -7.319, 11: -1.248, 12: 19.524, 13: -6.229,
}

export const W_P: Record<number, number> = {
  1: 0, 2: -2.055, 3: -0.456, 4: -15.959, 5: -3.792,
  6: -14.596, 7: 0, 8: -21.06, 9: -1.049,
}

export const MP_P: Record<number, number> = { 1: 0, 2: 2.847, 3: 0.664, 4: 1.16 }

export const WP_P: Record<number, number> = {
  1: 0, 2: 9.704, 3: 10.601, 4: 9.354, 5: 13.241,
  6: 5.483, 7: -1.572, 8: 7.413, 9: 7.396, 10: 10.975,
}

// Nθ-formlens koefficienter (β-værdier) og θ₂-korrektionen.
export const NTHETA_COEFFICIENTS = {
  bt: 0.456793,
  bCS: 0.04957,
  bCA: 0.157044,
  budb: 0.038245,
  bm1M: 0.026499,
  bf0: 0.016314,
  bf1: 0.026499,
  bg0: 0.014099,
  bm1G: 0.026499,
  theta2: 1.205144,
}

// L-formlens konstanter (NLES5: L = τ·(Y−1991) + (μ+Nθ+C)^κ · (P·S)^ρ).
export const L_FORMULA_CONSTANTS = {
  tau: -0.1108,
  mu: 23.51,
  kappa: 1.5,
  rho: 1.085,
}

// Sådato/etableringsinterval for efterafgrøde (EEA) — porteret fra
// streamlit_app.py (linje 75-92) og engine.py's FDATO_EFFECT_BY_DATE/
// FDATO_STEP_RATES, som backend'en (bridge_v2.py) rent faktisk bruger.
// Gælder som scenarie-global indstilling for alle år med efterafgrøde.

// §37: standard (ikke-præcision) etableringsintervaller — label -> repræsentativ dato.
export const FDATO_STANDARD_INTERVALS: { label: string; date: string }[] = [
  { label: 'Til og med 20. august (45%)', date: '20/8' },
  { label: '21.-24. august (42%)', date: '24/8' },
  { label: '25.-28. august (40%)', date: '28/8' },
  { label: '29. august - 7. september (33%)', date: '7/9' },
]

// §38: Bilag 8's daglige dagsbasis-kurve, kun tabuleret 9/8-7/9 (fristen i §33 stk. 1 nr. 2).
export const FDATO_OPTIONS: string[] = [
  '9/8', '10/8', '11/8', '12/8', '13/8', '14/8', '15/8', '16/8', '17/8', '18/8',
  '19/8', '20/8', '21/8', '22/8', '23/8', '24/8', '25/8', '26/8', '27/8', '28/8',
  '29/8', '30/8', '31/8', '1/9', '2/9', '3/9', '4/9', '5/9', '6/9', '7/9',
]

const FDATO_EFFECT_BY_DATE: Record<string, number> = {
  '9/8': 1.16, '10/8': 1.15, '11/8': 1.13, '12/8': 1.12, '13/8': 1.1,
  '14/8': 1.09, '15/8': 1.07, '16/8': 1.06, '17/8': 1.04, '18/8': 1.03,
  '19/8': 1.01, '20/8': 1.0, '21/8': 0.99, '22/8': 0.97, '23/8': 0.96,
  '24/8': 0.94, '25/8': 0.93, '26/8': 0.91, '27/8': 0.9, '28/8': 0.88,
  '29/8': 0.87, '30/8': 0.85, '31/8': 0.84, '1/9': 0.83, '2/9': 0.81,
  '3/9': 0.8, '4/9': 0.78, '5/9': 0.77, '6/9': 0.75, '7/9': 0.74,
}

const FDATO_STEP_RATES: { maxMonth: number; maxDay: number; pct: number }[] = [
  { maxMonth: 8, maxDay: 20, pct: 45 },
  { maxMonth: 8, maxDay: 24, pct: 42 },
  { maxMonth: 8, maxDay: 28, pct: 40 },
  { maxMonth: 9, maxDay: 7, pct: 33 },
]

const parseFdato = (value: string): [number, number] | null => {
  const [day, month] = value.split('/').map(Number)
  if (!day || !month) return null
  return [month, day]
}

const fdatoStepFactor = (value: string): number => {
  const parsed = parseFdato(value)
  if (!parsed) return 1
  const [month, day] = parsed
  for (const { maxMonth, maxDay, pct } of FDATO_STEP_RATES) {
    if (month < maxMonth || (month === maxMonth && day <= maxDay)) return pct / 45
  }
  return 0
}

// EEA's faste styrke (matcher bridge_v2.py's _EEA_STRENGTH).
const EEA_STRENGTH = 0.45

// Beregnet NUAR EEA-effekt i procent for det valgte sådato/interval — samme
// formel som streamlit_app.py's _fdato_effect_pct, til forhåndsvisning i
// "Nyt scenarie"-wizarden.
export const fdatoEffectPercent = (fdato: string, precision: boolean): number => {
  const factor = precision ? (FDATO_EFFECT_BY_DATE[fdato] ?? 1) : fdatoStepFactor(fdato)
  return EEA_STRENGTH * factor * 100
}

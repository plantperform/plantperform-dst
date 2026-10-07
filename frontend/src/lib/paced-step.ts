type PacedStep = {
  key: string
  step: number
  rested: boolean
}

export const startPacedStep = (key: string): PacedStep => ({
  key,
  step: 0,
  rested: false,
})

export const restPacedStep = (paced: PacedStep): PacedStep => ({
  ...paced,
  rested: true,
})

export const advancePacedStep = (
  paced: PacedStep,
  key: string,
  target: number,
): PacedStep => {
  if (paced.key !== key) return startPacedStep(key)
  if (!paced.rested || paced.step >= target) return paced
  return { key, step: paced.step + 1, rested: false }
}

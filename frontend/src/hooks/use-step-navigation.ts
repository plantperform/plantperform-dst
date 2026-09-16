import { useState } from 'react'

// Step state for a form split into steps. Going back never validates; going
// forward validates every step passed and stops at the first invalid one.
export const useStepNavigation = (
  validateStep: (index: number) => Promise<boolean>,
) => {
  const [stepIndex, setStepIndex] = useState(0)
  const [furthestStepIndex, setFurthestStepIndex] = useState(0)

  const goToStep = async (target: number) => {
    if (target <= stepIndex) {
      setStepIndex(target)
      return true
    }
    for (let index = stepIndex; index < target; index += 1) {
      if (!(await validateStep(index))) {
        setStepIndex(index)
        return false
      }
    }
    setStepIndex(target)
    setFurthestStepIndex((current) => Math.max(current, target))
    return true
  }

  // Validates every step from the start, for the final submit.
  const validateAllSteps = async (stepCount: number) => {
    for (let index = 0; index < stepCount; index += 1) {
      if (!(await validateStep(index))) {
        setStepIndex(index)
        return false
      }
    }
    return true
  }

  const resetSteps = () => {
    setStepIndex(0)
    setFurthestStepIndex(0)
  }

  return {
    stepIndex,
    furthestStepIndex,
    goToStep,
    validateAllSteps,
    resetSteps,
  }
}

import { ADVICE_THRESHOLD, readinessAdvice, readinessBand, scoreReadiness } from '../readiness'

describe('scoreReadiness', () => {
  it('sums the three answers and bands the result', () => {
    expect(scoreReadiness({ sleep: 5, energy: 5, soreness: 5 })).toEqual({ total: 15, band: 'good' })
    expect(scoreReadiness({ sleep: 4, energy: 3, soreness: 3 })).toEqual({ total: 10, band: 'ok' })
    expect(scoreReadiness({ sleep: 2, energy: 2, soreness: 3 })).toEqual({ total: 7, band: 'poor' })
  })

  it('clamps out-of-range answers instead of throwing mid-session', () => {
    expect(scoreReadiness({ sleep: 9, energy: 0, soreness: 3 })).toEqual({ total: 9, band: 'ok' })
    expect(scoreReadiness({ sleep: Number.NaN, energy: 1, soreness: 1 })).toEqual({ total: 3, band: 'poor' })
  })

  it('does not mutate its input', () => {
    const input = { sleep: 2, energy: 2, soreness: 2 }

    scoreReadiness(input)

    expect(input).toEqual({ sleep: 2, energy: 2, soreness: 2 })
  })

  it('is deterministic', () => {
    expect(scoreReadiness({ sleep: 3, energy: 4, soreness: 2 })).toEqual(
      scoreReadiness({ sleep: 3, energy: 4, soreness: 2 }),
    )
  })
})

describe('readinessBand', () => {
  it('splits at the advice threshold and at 12', () => {
    expect(readinessBand(ADVICE_THRESHOLD)).toBe('poor')
    expect(readinessBand(ADVICE_THRESHOLD + 1)).toBe('ok')
    expect(readinessBand(11)).toBe('ok')
    expect(readinessBand(12)).toBe('good')
  })
})

describe('readinessAdvice', () => {
  it('suggests trimming the session on a poor score', () => {
    expect(readinessAdvice(7, 'strength')).toBe('Consider skipping the AMRAP set')
    expect(readinessAdvice(7, 'cardio')).toBe('Shorten to about 70% of the target')
    expect(readinessAdvice(3, 'strength')).toBe('Consider skipping the AMRAP set')
  })

  it('says nothing above the threshold', () => {
    expect(readinessAdvice(8, 'strength')).toBeNull()
    expect(readinessAdvice(15, 'cardio')).toBeNull()
  })

  it('returns advice only — it never produces state to apply', () => {
    const advice = readinessAdvice(5, 'strength')

    expect(typeof advice).toBe('string')
    // The whole module's surface is two pure readers; there is nothing to mutate.
    expect(scoreReadiness({ sleep: 1, energy: 2, soreness: 2 })).toEqual({ total: 5, band: 'poor' })
  })
})

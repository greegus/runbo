import { canonicalName, EXERCISES, modalityOf, resolveExercise } from '../exercises'

describe('resolveExercise', () => {
  it('resolves a canonical name to its own entry', () => {
    expect(resolveExercise('Bench Press')?.canonical).toBe('Bench Press')
    expect(resolveExercise('Lat Pulldown')?.kind).toBe('machine')
  })

  it('resolves aliases in both directions', () => {
    expect(resolveExercise('Back Squat')?.canonical).toBe('Squat')
    expect(resolveExercise('Squat')?.aliases).toContain('Back Squat')
    expect(resolveExercise('OHP')?.canonical).toBe('Overhead Press')
    expect(resolveExercise('Pendlay Row')?.canonical).toBe('Bent Over Row')
  })

  it('ignores case, punctuation and extra spacing', () => {
    expect(resolveExercise('back squat')?.canonical).toBe('Squat')
    expect(resolveExercise('BENCH PRESS')?.canonical).toBe('Bench Press')
    expect(resolveExercise('  Pull-Up  ')?.canonical).toBe('Pull Up')
    expect(resolveExercise('lat pull down')?.canonical).toBe('Lat Pulldown')
  })

  it('drops the equipment Liftosaur appends after a comma', () => {
    expect(resolveExercise('Bench Press, Barbell')?.canonical).toBe('Bench Press')
    expect(resolveExercise('Lat Pulldown, Cable')?.canonical).toBe('Lat Pulldown')
  })

  it('returns undefined for a name the catalog does not know', () => {
    expect(resolveExercise('Zercher Good Morning')).toBeUndefined()
    expect(resolveExercise('')).toBeUndefined()
  })

  it('covers every GZCLP lift', () => {
    for (const lift of ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Lat Pulldown', 'Bent Over Row']) {
      expect(resolveExercise(lift)?.canonical).toBe(lift)
    }
  })
})

describe('cardio entries', () => {
  it('maps the three modalities and their aliases', () => {
    expect(modalityOf('Run')).toBe('run')
    expect(modalityOf('Running')).toBe('run')
    expect(modalityOf('Cycling')).toBe('bike')
    expect(modalityOf('ride')).toBe('bike')
    expect(modalityOf('Swimming')).toBe('swim')
  })

  it('gives strength lifts no modality', () => {
    expect(modalityOf('Squat')).toBeUndefined()
  })

  it('marks every modality entry as cardio and every cardio entry with a modality', () => {
    for (const entry of EXERCISES) {
      expect(entry.modality === undefined).toBe(entry.kind !== 'cardio')
    }
  })
})

describe('canonicalName', () => {
  it('canonicalises a known name and passes an unknown one through', () => {
    expect(canonicalName('db row')).toBe('Dumbbell Row')
    expect(canonicalName('Zercher Good Morning')).toBe('Zercher Good Morning')
    expect(canonicalName('Zercher Good Morning, Barbell')).toBe('Zercher Good Morning')
  })
})

describe('catalog integrity', () => {
  it('has no name claimed by two entries', () => {
    const seen = new Map<string, string>()
    for (const entry of EXERCISES) {
      for (const name of [entry.canonical, ...entry.aliases]) {
        const key = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
        expect(seen.get(key) ?? entry.canonical).toBe(entry.canonical)
        seen.set(key, entry.canonical)
      }
    }
  })
})

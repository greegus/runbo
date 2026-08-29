/**
 * The confirmation screen's shaping, driven end-to-end through `deriveState`
 * wherever it can be: the merge and the write-back only matter if they agree
 * with what the derive layer actually emits, and a hand-built `DerivedState`
 * cannot show that.
 */

import { describe, expect, it } from 'vitest'

import { deriveState, type UnmatchedExercise } from '@/import/deriveState'
import {
  applyRowEdits,
  buildCursorRow,
  buildDerivedRows,
  dedupeUnmatched,
  parseExerciseKey,
} from '@/onboarding/derivedRows'
import type { DerivedRow } from '@/onboarding/types'
import { GZCLP_PROGRAM_SOURCE, gzclpProgram } from '@/training/gzclp'
import type { GymSettings } from '@/training/plates'
import type { ExerciseState, Session, SetLog } from '@/types'

const settings: GymSettings = {
  units: 'kg',
  barbellWeight: 20,
  plates: [
    { weight: 25, count: 2 },
    { weight: 20, count: 2 },
    { weight: 15, count: 2 },
    { weight: 10, count: 2 },
    { weight: 5, count: 2 },
    { weight: 2.5, count: 2 },
    { weight: 1.25, count: 2 },
  ],
  restTimers: { t1: 180, t2: 120, t3: 60 },
  comebackGapDays: 10,
  notifications: { daily: false, gapNudge: false },
  fcmTokens: [],
}

const program = gzclpProgram()

function straight(count: number, reps: number, value: number, completed: number | null = reps): SetLog[] {
  return Array.from({ length: count }, () => ({
    prescribedReps: reps,
    isAmrap: false,
    completedReps: completed,
    weight: { value, unit: 'kg' as const },
  }))
}

/** GZCLP's `NxR+`: N−1 straight sets plus one AMRAP. */
function amrap(count: number, reps: number, value: number, amrapReps: number): SetLog[] {
  return [
    ...straight(count - 1, reps, value),
    { prescribedReps: reps, isAmrap: true, completedReps: amrapReps, weight: { value, unit: 'kg' as const } },
  ]
}

function session(id: string, date: string, programDay: string, exercises: Session['exercises']): Session {
  return { id, uid: 'u1', date, kind: 'strength', status: 'done', programDay, exercises }
}

function derive(sessions: Session[]) {
  return deriveState({ sessions, programText: GZCLP_PROGRAM_SOURCE, settings })
}

function rowFor(rows: DerivedRow[], key: string): DerivedRow {
  const found = rows.find((row) => row.key === key)
  if (!found) throw new Error(`no row for ${key}`)
  return found
}

describe('parseExerciseKey', () => {
  it('splits a tiered key', () => {
    expect(parseExerciseKey('T1:Squat')).toEqual({ tier: 1, lift: 'Squat' })
    expect(parseExerciseKey('T3:Lat Pulldown')).toEqual({ tier: 3, lift: 'Lat Pulldown' })
  })

  it('leaves an untiered key whole', () => {
    expect(parseExerciseKey('Face Pull')).toEqual({ tier: undefined, lift: 'Face Pull' })
  })

  it('splits on the first colon only, so a name may contain one', () => {
    expect(parseExerciseKey('T2:Squat: Front')).toEqual({ tier: 2, lift: 'Squat: Front' })
  })

  it('does not read a tier out of something that only looks like a label', () => {
    expect(parseExerciseKey('T4:Squat')).toEqual({ tier: undefined, lift: 'T4:Squat' })
  })
})

describe('buildDerivedRows', () => {
  const derived = derive([
    session('s1', '2026-08-10', 'A1', [
      { name: 'Squat', tier: 1, sets: amrap(5, 3, 100, 6) },
      { name: 'Bench Press', tier: 2, sets: straight(3, 10, 60) },
    ]),
  ])
  const rows = buildDerivedRows(derived, derived.programState, program)

  it('lists every program lift, not only the ones with history', () => {
    expect(rows).toHaveLength(10)
    expect(rows.map((row) => row.key)).toContain('T1:Deadlift')
  })

  it('follows program order, first line wins', () => {
    expect(rows.slice(0, 3).map((row) => row.key)).toEqual(['T1:Squat', 'T2:Bench Press', 'T3:Lat Pulldown'])
  })

  it('reads the editable weight off programState — the NEXT weight, not the logged one', () => {
    const row = rowFor(rows, 'T1:Squat')

    // The replay progressed 100 kg; the log still says 100 was what was lifted.
    expect(row.weight).toBe(derived.programState['T1:Squat'].weights[0].value)
    expect(row.observedWeight).toEqual({ value: 100, unit: 'kg' })
    expect(row.weightConfidence).toBe('certain')
  })

  it('carries the logged shape, the match kind and the last date', () => {
    const row = rowFor(rows, 'T1:Squat')

    expect(row.observedShape).toBe('5x3+')
    expect(row.matchKind).toBe('exact')
    expect(row.lastLoggedDate).toBe('2026-08-10')
    expect(row.variationConfidence).toBe('certain')
  })

  it('leaves a lift with no history ask-weight and flags nothing to review', () => {
    const row = rowFor(rows, 'T1:Deadlift')

    expect(row.weight).toBeNull()
    expect(row.observedWeight).toBeNull()
    expect(row.keyResolution).toBe('none')
    expect(row.needsReview).toBe(false)
    expect(row.reviewReasons).toEqual([])
  })

  it('reads tier, name and variation count off the program', () => {
    expect(rowFor(rows, 'T1:Squat')).toMatchObject({ tier: 1, lift: 'Squat', variationCount: 3 })
    expect(rowFor(rows, 'T3:Lat Pulldown')).toMatchObject({ tier: 3, variationCount: 1 })
  })

  it('marks a row for review with a reason when nothing was ever completed', () => {
    const nothing = derive([
      session('s1', '2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: straight(5, 3, 100, null) }]),
    ])
    const row = rowFor(buildDerivedRows(nothing, nothing.programState, program), 'T1:Squat')

    expect(row.weight).toBeNull()
    expect(row.weightConfidence).toBe('guess')
    expect(row.needsReview).toBe(true)
    expect(row.reviewReasons.join(' ')).toContain('Nothing was ever completed')
  })

  it('keeps the unit of a stored weight', () => {
    const lbState: Record<string, ExerciseState> = {
      'T1:Squat': { weights: [{ value: 225, unit: 'lb' }], setVariationIndex: 1, state: {} },
    }
    const rowsLb = buildDerivedRows(derive([]), lbState, program)

    expect(rowFor(rowsLb, 'T1:Squat').unit).toBe('lb')
  })
})

describe('buildCursorRow', () => {
  it('carries the derived cursor and the day names of the program', () => {
    const derived = derive([session('s1', '2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrap(5, 3, 100, 6) }])])
    const cursor = buildCursorRow(derived, program)

    expect(cursor.value).toBe(derived.rotationCursor)
    expect(cursor.dayNames).toEqual(['A1', 'B1', 'A2', 'B2'])
    expect(cursor.source).toBe('gzclp-rotation')
    expect(cursor.confidence).toBe('certain')
    expect(cursor.suspect).toBe(false)
  })

  it('reports a suspect cursor when the label and the content disagree', () => {
    const derived = derive([
      session('s1', '2026-08-10', 'A1', [{ name: 'Deadlift', tier: 1, sets: amrap(5, 3, 140, 5) }]),
    ])

    expect(buildCursorRow(derived, program).suspect).toBe(true)
  })
})

describe('dedupeUnmatched', () => {
  it('collapses repeats to one row and keeps the newest sighting', () => {
    const entries: UnmatchedExercise[] = [
      { key: 'T3:Face Pull', name: 'Face Pull', reason: 'not-in-program', lastLoggedDate: '2026-07-01' },
      { key: 'T3:Face Pull', name: 'Face Pull', reason: 'not-in-program', lastLoggedDate: '2026-08-20' },
      {
        key: 'Squat',
        name: 'Squat',
        reason: 'ambiguous-tier',
        lastLoggedDate: '2026-08-01',
        candidateKeys: ['T1:Squat'],
      },
      {
        key: 'Squat',
        name: 'Squat',
        reason: 'ambiguous-tier',
        lastLoggedDate: '2026-07-01',
        candidateKeys: ['T2:Squat'],
      },
    ]
    const deduped = dedupeUnmatched(entries)

    expect(deduped).toHaveLength(2)
    expect(deduped[0].lastLoggedDate).toBe('2026-08-20')
    expect(deduped[1].candidateKeys).toEqual(['T1:Squat', 'T2:Squat'])
  })

  it('never mutates its argument', () => {
    const entries: UnmatchedExercise[] = [
      {
        key: 'Squat',
        name: 'Squat',
        reason: 'ambiguous-tier',
        lastLoggedDate: '2026-07-01',
        candidateKeys: ['T1:Squat'],
      },
      {
        key: 'Squat',
        name: 'Squat',
        reason: 'ambiguous-tier',
        lastLoggedDate: '2026-08-01',
        candidateKeys: ['T2:Squat'],
      },
    ]
    dedupeUnmatched(entries)

    expect(entries[0].candidateKeys).toEqual(['T1:Squat'])
    expect(entries[0].lastLoggedDate).toBe('2026-07-01')
  })
})

describe('applyRowEdits', () => {
  const base: Record<string, ExerciseState> = {
    'T1:Squat': {
      weights: [{ value: 100, unit: 'kg' }],
      setVariationIndex: 1,
      state: { increment: 5 },
      askWeight: true,
    },
  }

  function row(patch: Partial<DerivedRow>): DerivedRow {
    return {
      key: 'T1:Squat',
      lift: 'Squat',
      tier: 1,
      observedWeight: null,
      observedShape: '',
      weightConfidence: null,
      variationConfidence: null,
      matchKind: null,
      keyResolution: 'none',
      lastLoggedDate: null,
      tiedCandidates: [],
      replayFailed: false,
      replayDiagnostics: [],
      needsReview: false,
      reviewReasons: [],
      weight: null,
      unit: 'kg',
      stage: 1,
      variationCount: 3,
      ...patch,
    }
  }

  it('writes a weight, the stage, and DELETES askWeight rather than setting it false', () => {
    const next = applyRowEdits([row({ weight: 105, stage: 2 })], base)

    expect(next['T1:Squat'].weights).toEqual([{ value: 105, unit: 'kg' }])
    expect(next['T1:Squat'].setVariationIndex).toBe(2)
    expect('askWeight' in next['T1:Squat']).toBe(false)
  })

  it('turns an empty weight back into ask-weight', () => {
    const next = applyRowEdits([row({ weight: null, stage: 3 })], base)

    expect(next['T1:Squat'].weights).toEqual([])
    expect(next['T1:Squat'].askWeight).toBe(true)
    expect(next['T1:Squat'].setVariationIndex).toBe(3)
  })

  it('carries the custom-progression state vars through untouched, both ways', () => {
    expect(applyRowEdits([row({ weight: 105 })], base)['T1:Squat'].state).toEqual({ increment: 5 })
    expect(applyRowEdits([row({ weight: null })], base)['T1:Squat'].state).toEqual({ increment: 5 })
  })

  it('clamps a stage to the variation count of the line', () => {
    expect(applyRowEdits([row({ weight: 100, stage: 9 })], base)['T1:Squat'].setVariationIndex).toBe(3)
    expect(applyRowEdits([row({ weight: 100, stage: 0 })], base)['T1:Squat'].setVariationIndex).toBe(1)
  })

  it('treats a non-positive weight as ask-weight, never as a 0 kg prescription', () => {
    expect(applyRowEdits([row({ weight: 0 })], base)['T1:Squat'].askWeight).toBe(true)
    expect(applyRowEdits([row({ weight: Number.NaN })], base)['T1:Squat'].askWeight).toBe(true)
  })

  it('leaves keys the rows do not mention alone and never mutates the base', () => {
    const withOther: Record<string, ExerciseState> = {
      ...base,
      'T2:Squat': { weights: [{ value: 80, unit: 'kg' }], setVariationIndex: 1, state: {} },
    }
    const next = applyRowEdits([row({ weight: 105 })], withOther)

    expect(next['T2:Squat']).toEqual(withOther['T2:Squat'])
    expect(withOther['T1:Squat'].weights).toEqual([{ value: 100, unit: 'kg' }])
    expect(withOther['T1:Squat'].askWeight).toBe(true)
  })

  it('round-trips a built row list without changing anything', () => {
    const derived = derive([session('s1', '2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrap(5, 3, 100, 6) }])])
    const rows = buildDerivedRows(derived, derived.programState, program)

    expect(applyRowEdits(rows, derived.programState)).toEqual(derived.programState)
  })
})

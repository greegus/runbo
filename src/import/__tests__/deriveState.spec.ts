/**
 * `deriveState` against hand-built sessions.
 *
 * Most of the input is `Session[]` literals — the mapper's OUTPUT type, which is
 * what `deriveState` actually takes, and the right seam anyway since this module
 * never sees a Liftosaur field. The last `describe` closes the loop the other
 * way: it feeds `importLiftosaurHistory(...).sessions` straight in, because the
 * two modules were written in parallel and the spellings they have to agree on
 * (canonical exercise names, `T1:` labels, verbatim program days, units) are
 * invisible to a suite that only ever hand-writes them.
 */

import { GZCLP_PROGRAM_SOURCE, gzclpProgram, initialProgramState } from '@/training/gzclp'
import type { GymSettings } from '@/training/plates'
import type { Session, SetLog } from '@/types'

import { cursorOfDay, deriveState, formatShape, programSlotOf } from '../deriveState'
import { importLiftosaurHistory } from '../liftosaurHistory'
import { adoptProgramText } from '../programText'
import { gzclp, nonProgram } from './fixtures'

/** The kg defaults from `Profile.settings`: a 20 kg bar, 1.25 kg smallest plate. */
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
  notifications: { daily: true, gapNudge: true },
  fcmTokens: [],
}

function kg(value: number) {
  return { value, unit: 'kg' as const }
}

/** `count` straight sets at `weight`, all completed at the target. */
function straight(count: number, reps: number, value: number, completed = reps): SetLog[] {
  return Array.from({ length: count }, () => ({
    prescribedReps: reps,
    isAmrap: false,
    completedReps: completed,
    weight: kg(value),
  }))
}

/** GZCLP's `NxR+`: N-1 straight sets plus one AMRAP, the way `prescribe` flags them. */
function amrapScheme(count: number, reps: number, value: number, amrapReps: number): SetLog[] {
  return [
    ...straight(count - 1, reps, value),
    { prescribedReps: reps, isAmrap: true, completedReps: amrapReps, weight: kg(value) },
  ]
}

let sessionCounter = 0

/** A finished strength session. Ids are sequential so the sort is deterministic. */
function session(date: string, programDay: string, exercises: Session['exercises']): Session {
  sessionCounter += 1
  return {
    id: `s${String(sessionCounter).padStart(3, '0')}`,
    uid: 'u1',
    date,
    kind: 'strength',
    status: 'done',
    programDay,
    exercises,
  }
}

function derive(sessions: Session[], programText = GZCLP_PROGRAM_SOURCE) {
  return deriveState({ sessions, programText, settings })
}

/** A program the parser refuses: `state.nope()` is not a function it knows. */
const broken = `# Week 1
## A1
T1: Squat / 5x3+ / 100kg / progress: custom(inc: 5kg) {~ weights += state.nope() ~}
`

function derivationFor(result: ReturnType<typeof derive>, key: string) {
  const found = result.report.exercises.find((exercise) => exercise.key === key)
  expect(found, `a derivation for ${key}`).toBeDefined()
  return found!
}

describe('deriveState', () => {
  it('reads the working weight, the stage and the cursor off a clean mid-program history', () => {
    // Two A1 days at variation 1 (5x3+), the second one heavier: the athlete hit
    // every rep, so GZCLP added 5 kg between them.
    const result = derive([
      session('2026-08-10', 'A1', [
        { name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) },
        { name: 'Bench Press', tier: 2, sets: straight(3, 10, 60) },
        { name: 'Lat Pulldown', tier: 3, sets: amrapScheme(3, 15, 40, 18) },
      ]),
      session('2026-08-13', 'B1', [{ name: 'Overhead Press', tier: 1, sets: amrapScheme(5, 3, 45, 4) }]),
    ])

    expect(result.report.derived).toBe(true)
    expect(result.report.sessionsRead).toBe(2)
    expect(result.report.unmatched).toEqual([])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.weight).toEqual({ value: kg(100), confidence: 'certain' })
    expect(squat.variation).toMatchObject({ performedIndex: 1, match: 'exact', confidence: 'certain' })
    expect(squat.replayed).toBe(true)

    // Replay, not arithmetic: every rep was hit at stage 1, so the program's own
    // script adds `state.inc` (5 kg) and holds the stage.
    expect(result.programState['T1:Squat']).toMatchObject({ weights: [kg(105)], setVariationIndex: 1 })
    expect(result.programState['T2:Bench Press']).toMatchObject({ weights: [kg(62.5)], setVariationIndex: 1 })

    // The last logged day is B1, so the athlete is due A2 — cursor 2.
    expect(result.rotationCursor).toBe(2)
    expect(result.report.cursor).toMatchObject({ source: 'gzclp-rotation', confidence: 'certain', suspect: false })
    expect(result.report.needsReview).toEqual([])
  })

  it('leaves an exercise with no logged history exactly as the program state found it', () => {
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }])])
    const untouched = initialProgramState(GZCLP_PROGRAM_SOURCE, {})

    expect(result.programState['T1:Deadlift']).toEqual(untouched['T1:Deadlift'])
    expect(result.programState['T1:Deadlift'].askWeight).toBe(true)
    expect(result.report.exercises.map((exercise) => exercise.key)).toEqual(['T1:Squat'])
  })

  it('recovers a T1 sitting mid-stage from the set scheme alone', () => {
    // `6x2+` is GZCLP T1 stage 2. Nothing in a log says "stage 2" — only the
    // shape does, which is the whole reason the matcher exists.
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(6, 2, 110, 3) }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation).toMatchObject({ performedIndex: 2, seededIndex: 2, match: 'exact', confidence: 'certain' })
    // One group, not two: the AMRAP set shares its prescription and weight with
    // the five before it, which is exactly how the AST spells `6x2+`.
    expect(squat.variation.loggedShape).toBe('6x2+')

    // Every rep hit at stage 2 → the weight goes up, the stage stays.
    expect(result.programState['T1:Squat']).toMatchObject({ weights: [kg(115)], setVariationIndex: 2 })
    expect(result.report.needsReview).toEqual([])
  })

  it('turns a stage-3 miss into the program deload, not an increment', () => {
    // `10x1+` at 120 kg with the AMRAP set logged at 0: a real miss, marked done
    // at zero. GZCLP resets to stage 1 at 85 % — 102 kg rounds down to 100.
    const missed: SetLog[] = [
      ...straight(9, 1, 120),
      { prescribedReps: 1, isAmrap: true, completedReps: 0, weight: kg(120) },
    ]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: missed }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation).toMatchObject({ performedIndex: 3, match: 'exact', confidence: 'certain' })
    expect(squat.weight.value).toEqual(kg(120))
    expect(squat.replayed).toBe(true)

    const next = result.programState['T1:Squat']
    expect(next.setVariationIndex).toBe(1)
    expect(next.weights[0].value).toBeLessThan(120)
  })

  it('keeps a lift ask-weight when every logged set was skipped', () => {
    // `completedReps: 0` is a set marked done at zero and `null` is untouched.
    // Neither is evidence that the athlete moved the bar.
    const skipped: SetLog[] = [
      { prescribedReps: 3, isAmrap: false, completedReps: 0, weight: kg(100) },
      { prescribedReps: 3, isAmrap: false, completedReps: null, weight: kg(100) },
      { prescribedReps: 3, isAmrap: true, completedReps: null, weight: kg(100) },
    ]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: skipped }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.weight).toEqual({ value: null, confidence: 'guess' })
    expect(squat.replayed).toBe(false)
    expect(result.programState['T1:Squat'].weights).toEqual([])
    expect(result.programState['T1:Squat'].askWeight).toBe(true)
    expect(result.report.needsReview).toContain('T1:Squat')
  })

  it('ignores a lighter back-off set logged after the working sets', () => {
    const sets: SetLog[] = [...amrapScheme(5, 3, 100, 4), ...straight(1, 8, 70)]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets }])])

    expect(derivationFor(result, 'T1:Squat').weight.value).toEqual(kg(100))
  })

  it('takes the heaviest entry when one session logs the same lift twice', () => {
    // Liftosaur entry ids are not unique within a day, so an ad-hoc second entry
    // after the work sets is ordinary data. The heaviest wins — the same rule
    // that already applies to the sets inside one entry — and the disagreement
    // between the two entries is reported rather than resolved silently.
    const result = derive(
      [
        session('2026-08-10', 'A2', [
          { name: 'Squat', tier: 2, sets: straight(3, 10, 70) },
          { name: 'Squat', tier: 2, sets: straight(3, 10, 40) },
        ]),
      ],
      `# Week 1\n## A2\nT2: Squat / 3x10 / 3x8 / 70kg / progress: lp(2.5kg)\n`,
    )

    const squat = derivationFor(result, 'T2:Squat')
    expect(squat.weight).toEqual({ value: kg(70), confidence: 'likely' })
    expect(result.programState['T2:Squat'].weights).toEqual([kg(72.5)])
    expect(result.report.needsReview).toContain('T2:Squat')
  })

  it('replays from the working weight, not from a lighter set logged among the work sets', () => {
    // `evaluateSession` reads its base weight off the LOGGED sets, so a ramp-up
    // set left inside the working sets would re-base the whole progression on
    // 80 kg and come back with 85.
    const ramped: SetLog[] = [...straight(1, 3, 80), ...amrapScheme(4, 3, 100, 5)]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: ramped }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.weight).toEqual({ value: kg(100), confidence: 'likely' })
    expect(result.programState['T1:Squat'].weights).toEqual([kg(105)])
    // The report and the state agree, and the disagreement inside the log is
    // what the confirmation screen is told to look at.
    expect(result.report.needsReview).toContain('T1:Squat')
  })

  it('attaches a tiered log to an untiered program line rather than discarding it', () => {
    const untiered = `# Week 1
## A1
Squat / 5x5 / 100kg / progress: lp(5kg)
`
    const result = derive(
      [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: straight(5, 5, 100) }])],
      untiered,
    )

    const squat = derivationFor(result, 'Squat')
    expect(squat.keyResolution).toBe('tier-dropped')
    expect(squat.weight.value).toEqual(kg(100))
    // The label was dropped to make the match, so a human confirms it.
    expect(result.report.needsReview).toContain('Squat')
  })

  it('matches a program line written under a catalog alias and a lower-case tier label', () => {
    // The importer canonicalizes every logged name ('OHP' -> 'Overhead Press'),
    // and the parser keeps the label the athlete typed. Neither spelling may
    // detach the history — and the key written into `programState` stays the
    // program's own, because that is what the engine reads.
    const aliased = `# Week 1
## A1
t1: OHP / 5x3+ / 6x2+ / 45kg / progress: lp(2.5kg)
`
    const result = derive(
      [session('2026-08-10', 'A1', [{ name: 'Overhead Press', tier: 1, sets: amrapScheme(5, 3, 50, 5) }])],
      aliased,
    )

    expect(result.report.unmatched).toEqual([])
    const press = derivationFor(result, 't1:OHP')
    expect(press.keyResolution).toBe('logged')
    expect(press.weight.value).toEqual(kg(50))
    expect(result.programState['t1:OHP'].weights).toEqual([kg(52.5)])
  })

  it('reads the weight from the most recent session that completed anything', () => {
    const result = derive([
      session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }]),
      session('2026-08-17', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 105, 4) }]),
    ])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.weight.value).toEqual(kg(105))
    expect(squat.lastLoggedDate).toBe('2026-08-17')
    // Only the LAST session is replayed: the 105 already contains the earlier
    // increment, so replaying both would double-apply it.
    expect(result.programState['T1:Squat'].weights).toEqual([kg(110)])
  })

  it('flags a tie between variations instead of pretending it matched one', () => {
    // Both variations are 3x8 — the only difference is the weight, which the
    // matcher deliberately does not look at.
    const ambiguous = `# Week 1
## A1
T1: Squat / 3x8 / 3x8 / 100kg / progress: lp(5kg)
`
    const result = derive(
      [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: straight(3, 8, 100) }])],
      ambiguous,
    )

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation.confidence).toBe('guess')
    expect(squat.variation.performedIndex).toBe(1) // lowest of the tied indices
    expect(squat.variation.tiedCandidates).toEqual([
      { index: 1, shape: '3x8' },
      { index: 2, shape: '3x8' },
    ])
    expect(result.report.needsReview).toContain('T1:Squat')
  })

  it('says so when no variation matches at all, and still keeps the weight', () => {
    // `1x5 (5RM Test)` is Liftosaur's GZCLP stage 4. runbo's built-in T1 has
    // three variations and none of them is a single set of five.
    const retest: SetLog[] = [
      { prescribedReps: 5, isAmrap: false, completedReps: 5, weight: kg(130), label: '5RM Test' },
    ]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: retest }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation).toMatchObject({ performedIndex: null, match: null, confidence: 'guess', seededIndex: 1 })
    expect(squat.variation.loggedShape).toBe('1x5')
    expect(squat.weight.value).toEqual(kg(130))
    expect(result.report.needsReview).toContain('T1:Squat')
  })

  it('finds the variation by its label when no shape tier can', () => {
    // A retest set matches nothing on count or reps; the label it carries is the
    // only thing that says which stage it was. This is the tier that catches
    // GZCLP's `(5RM Test)` on a program that spells it out.
    const labelled = `# Week 1
## A1
T1: Squat / 3x8 / 2x10 (5RM Test) / 100kg / progress: lp(5kg)
`
    const retest: SetLog[] = [
      { prescribedReps: 5, isAmrap: false, completedReps: 5, weight: kg(130), label: '5RM Test' },
    ]
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: retest }])], labelled)

    expect(derivationFor(result, 'T1:Squat').variation).toMatchObject({
      performedIndex: 2,
      match: 'label',
      confidence: 'likely',
    })
  })

  it('falls back to the set count alone when nothing stricter separates the variations', () => {
    // Three sets of five: the reps match neither variation, so only the number
    // of sets can tell `3x8` from `5x5`.
    const counted = `# Week 1
## A1
T1: Squat / 3x8 / 5x5 / 100kg / progress: lp(5kg)
`
    const result = derive(
      [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: straight(3, 5, 100) }])],
      counted,
    )

    expect(derivationFor(result, 'T1:Squat').variation).toMatchObject({
      performedIndex: 1,
      match: 'totalSets',
      confidence: 'likely',
    })
  })

  it('matches a set scheme regrouped by the exporter on the rep pattern', () => {
    // Logged as ten flat singles rather than `9x1, 1x1+`: the same ten reps in a
    // different grouping, which only the looser tiers can see.
    const flat = straight(10, 1, 120)
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: flat }])])

    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation).toMatchObject({ performedIndex: 3, match: 'countAndReps', confidence: 'likely' })
    // 'likely' is not 'certain', so a human still sees it.
    expect(result.report.needsReview).toContain('T1:Squat')
  })

  it('infers the tier when the program has exactly one line of that name', () => {
    // A pre-2026-03 Liftosaur export carries no tier at all. Lat Pulldown is
    // only ever a T3 in the built-in program, so there is nothing to be unsure of.
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Lat Pulldown', sets: straight(3, 15, 40) }])])

    const pulldown = derivationFor(result, 'T3:Lat Pulldown')
    expect(pulldown.keyResolution).toBe('tier-inferred-by-key')
    expect(pulldown.weight.value).toEqual(kg(40))
    expect(result.report.needsReview).toContain('T3:Lat Pulldown')
  })

  it('infers the tier from the set shape when the name exists at two tiers', () => {
    // Squat is T1 (5x3+) on A1 and T2 (3x10) on A2. `3x10` can only be the T2.
    const result = derive([session('2026-08-10', 'A2', [{ name: 'Squat', sets: straight(3, 10, 75) }])])

    const squat = derivationFor(result, 'T2:Squat')
    expect(squat.keyResolution).toBe('tier-inferred-by-shape')
    expect(squat.variation.performedIndex).toBe(1)
  })

  it('drops a tier-less entry it cannot tell apart rather than guessing a tier', () => {
    // Both Squat lines are 5x5, so neither the key nor the shape can say which
    // one the athlete logged. Attaching T2's history to the T1 line would put a
    // volume weight on the max-effort lift, so nothing is decided at all.
    const twoSquats = `# Week 1
## A1
T1: Squat / 5x5 / 100kg / progress: lp(5kg)
## A2
T2: Squat / 5x5 / 80kg / progress: lp(5kg)
`
    const result = derive([session('2026-08-10', 'A1', [{ name: 'Squat', sets: straight(5, 5, 100) }])], twoSquats)

    expect(result.report.exercises).toEqual([])
    expect(result.report.unmatched).toEqual([
      {
        key: 'Squat',
        name: 'Squat',
        reason: 'ambiguous-tier',
        lastLoggedDate: '2026-08-10',
        candidateKeys: ['T1:Squat', 'T2:Squat'],
      },
    ])
    expect(result.report.needsReview).toContain('Squat')
  })

  it('reports an exercise the program does not have without touching the program state', () => {
    const result = derive([
      session('2026-08-10', 'A1', [
        { name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) },
        { name: 'Face Pull', tier: 3, sets: straight(3, 15, 20) },
      ]),
    ])

    expect(result.report.unmatched).toEqual([
      { key: 'T3:Face Pull', name: 'Face Pull', tier: 3, reason: 'not-in-program', lastLoggedDate: '2026-08-10' },
    ])
    expect(result.programState['T3:Face Pull']).toBeUndefined()
    expect(result.programState['T1:Squat'].weights).toEqual([kg(105)])
  })

  it('does not pretend a day from another program means the athlete is at the start', () => {
    const result = derive([
      session('2026-08-10', 'Push Day', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }]),
    ])

    expect(result.rotationCursor).toBe(0)
    expect(result.report.cursor).toMatchObject({
      value: 0,
      source: 'unknown-day',
      confidence: 'guess',
      lastProgramDay: 'Push Day',
    })
    expect(result.report.needsReview).toContain('rotationCursor')
  })

  it('derives the cursor from the program day list when the day is off the GZCLP rotation', () => {
    const custom = `# Week 1
## Upper
T1: Bench Press / 5x5 / 80kg / progress: lp(2.5kg)
## Lower
T1: Squat / 5x5 / 100kg / progress: lp(5kg)
`
    const result = derive(
      [session('2026-08-10', 'Upper', [{ name: 'Bench Press', tier: 1, sets: straight(5, 5, 80) }])],
      custom,
    )

    expect(result.rotationCursor).toBe(1)
    expect(result.report.cursor).toMatchObject({
      source: 'program-days',
      // A program-day index is not the number the rest of the app reads out of
      // `rotationCursor` — `composeWeek` indexes `GZCLP_ROTATION` with it — so a
      // cursor recovered this way is never more than a guess.
      confidence: 'guess',
      lastProgramDay: 'Upper',
      nextProgramDay: 'Lower',
    })
    expect(result.report.needsReview).toContain('rotationCursor')
  })

  it('keeps a program-day cursor inside the rotation the rest of the app indexes', () => {
    // Six days: the fifth is program-day index 4, and a raw `4` would send
    // `composeWeek` past the end of `GZCLP_ROTATION` and back to 'A1'.
    const days = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
    const long = `# Week 1\n${days.map((day) => `## ${day}\nT1: Squat / 5x5 / 100kg / progress: lp(5kg)\n`).join('')}`
    const result = derive([session('2026-08-10', 'D5', [{ name: 'Squat', tier: 1, sets: straight(5, 5, 100) }])], long)

    expect(result.rotationCursor).toBeLessThan(4)
    expect(result.report.cursor).toMatchObject({ source: 'program-days', nextProgramDay: 'D6', confidence: 'guess' })
  })

  it('marks the cursor suspect when the last session logged nothing its own day trains', () => {
    // The session is labelled A1 but the athlete deadlifted, which is B2 work.
    // The label is wrong, so the cursor derived from it cannot be trusted.
    const result = derive([
      session('2026-08-10', 'A1', [{ name: 'Deadlift', tier: 1, sets: amrapScheme(5, 3, 140, 4) }]),
    ])

    expect(result.report.cursor.suspect).toBe(true)
    expect(result.report.needsReview).toContain('rotationCursor')
    // Flagged, not corrected — the confirmation screen is editable.
    expect(result.rotationCursor).toBe(1)
  })

  it('returns the untouched defaults for an empty history', () => {
    const result = derive([])

    expect(result.programState).toEqual(initialProgramState(GZCLP_PROGRAM_SOURCE, {}))
    expect(result.rotationCursor).toBe(0)
    expect(result.report).toMatchObject({
      derived: true,
      sessionsRead: 0,
      exercises: [],
      unmatched: [],
      needsReview: ['rotationCursor'],
    })
    expect(result.report.cursor.source).toBe('no-program-day')
  })

  it('ignores cardio and unfinished sessions', () => {
    const active: Session = {
      ...session('2026-08-17', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 200, 5) }]),
      status: 'active',
    }
    const cardio: Session = { id: 'c1', uid: 'u1', date: '2026-08-18', kind: 'cardio', status: 'done', minutes: 30 }
    const result = derive([
      session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }]),
      active,
      cardio,
    ])

    expect(result.report.sessionsRead).toBe(1)
    expect(derivationFor(result, 'T1:Squat').weight.value).toEqual(kg(100))
  })

  it('derives nothing at all from a program that does not parse', () => {
    const result = derive(
      [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }])],
      broken,
    )

    expect(result.report.derived).toBe(false)
    expect(result.report.diagnostics.length).toBeGreaterThan(0)
    expect(result.programState).toEqual({})
    expect(result.rotationCursor).toBe(0)
  })

  it('derives nothing from a broken program even when handed a base state', () => {
    // The wizard's own composition: `adoptProgramText` refuses the program and
    // hands back `programState: {}`, which is truthy. The refusal belongs to
    // `deriveState`, not to whether `initialProgramState` happened to be called.
    const adopted = adoptProgramText(broken)
    expect(adopted.adopted).toBe(false)

    const result = deriveState({
      sessions: [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }])],
      programText: broken,
      settings,
      baseProgramState: adopted.programState,
    })

    expect(result.report.derived).toBe(false)
    expect(result.programState).toEqual({})
    expect(result.rotationCursor).toBe(0)
  })

  it('treats an empty base state as no base state at all', () => {
    const result = deriveState({
      sessions: [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }])],
      programText: GZCLP_PROGRAM_SOURCE,
      settings,
      baseProgramState: {},
    })

    expect(result.report.unmatched).toEqual([])
    expect(result.programState['T1:Squat'].weights).toEqual([kg(105)])
  })

  it('starts from the program state it is handed instead of re-deriving one', () => {
    const base = initialProgramState(GZCLP_PROGRAM_SOURCE, { 'T1:Deadlift': { weight: kg(150), stage: 2 } })
    const result = deriveState({
      sessions: [session('2026-08-10', 'A1', [{ name: 'Squat', tier: 1, sets: amrapScheme(5, 3, 100, 5) }])],
      programText: GZCLP_PROGRAM_SOURCE,
      settings,
      baseProgramState: base,
    })

    // Untouched by the history, carried straight through from the caller.
    expect(result.programState['T1:Deadlift']).toEqual(base['T1:Deadlift'])
    expect(result.programState['T1:Squat'].weights).toEqual([kg(105)])
  })
})

describe('the importer seam', () => {
  it('derives state from the mapper own output, with no hand-written session in between', () => {
    const imported = importLiftosaurHistory(gzclp, { uid: 'u1' })
    const result = deriveState({ sessions: imported.sessions, programText: GZCLP_PROGRAM_SOURCE, settings })

    expect(imported.report.failure).toBeUndefined()
    // Every logged exercise reached a program line: the mapper's canonical names
    // and `T1:` labels line up with the ones `sessionExerciseKey` builds.
    expect(result.report.unmatched).toEqual([])
    expect(result.report.exercises).toHaveLength(Object.keys(result.programState).length)

    // The fixture's newest T1 Squat is the `10x1+` stage-3 miss at 120 kg.
    const squat = derivationFor(result, 'T1:Squat')
    expect(squat.variation).toMatchObject({ performedIndex: 3, match: 'exact' })
    expect(squat.weight.value).toEqual(kg(120))
    expect(result.programState['T1:Squat'].setVariationIndex).toBe(1) // the deload

    // The last workout is B1, so the athlete is due A2.
    expect(result.rotationCursor).toBe(2)
    expect(result.report.cursor).toMatchObject({ source: 'gzclp-rotation', confidence: 'certain' })
  })

  it('reports a mapped exercise the program does not have, and a day from another program', () => {
    const imported = importLiftosaurHistory(nonProgram, { uid: 'u1' })
    const result = deriveState({ sessions: imported.sessions, programText: GZCLP_PROGRAM_SOURCE, settings })

    expect(result.report.unmatched).toEqual([
      { key: 'T3:Face Pull', name: 'Face Pull', tier: 3, reason: 'not-in-program', lastLoggedDate: '2026-06-11' },
    ])
    expect(result.programState['T3:Face Pull']).toBeUndefined()
    expect(result.rotationCursor).toBe(0)
    expect(result.report.cursor).toMatchObject({ source: 'unknown-day', lastProgramDay: 'Push Day' })
  })
})

describe('formatShape', () => {
  it('spells a scheme the way the evaluator does', () => {
    expect(formatShape([{ count: 5, target: 3, isAmrap: true }])).toBe('5x3+')
    expect(formatShape([{ count: 3, target: 12, minReps: 8, isAmrap: false }])).toBe('3x8-12')
    expect(
      formatShape([
        { count: 4, target: 3, isAmrap: false },
        { count: 1, target: 3, isAmrap: true },
      ]),
    ).toBe('4x3, 1x3+')
  })
})

describe('program day helpers', () => {
  it('places a GZCLP day on the rotation and an off-rotation day nowhere', () => {
    expect(cursorOfDay('A1')).toBe(0)
    expect(cursorOfDay('B2')).toBe(3)
    expect(cursorOfDay('Push Day')).toBeNull()
    expect(cursorOfDay(undefined)).toBeNull()
  })

  it('resolves a program day to its 1-based slot, and an unknown one to the first', () => {
    const program = gzclpProgram()
    expect(programSlotOf(program, 'A2')).toEqual({ week: 1, day: 3 })
    expect(programSlotOf(program, 'nope')).toEqual({ week: 1, day: 1 })
  })
})

import { convert, weight as makeWeight } from '@/liftoscript/weight'
import type { Session, SetLog } from '@/types'

import {
  CORRUPT_HISTORY_MESSAGE,
  importLiftosaurHistory,
  IMPORT_REASONS,
  NOT_AN_EXPORT_MESSAGE,
  reasonMessage,
  WRONG_EXPORT_MESSAGE,
  type ImportResult,
  type ReasonId,
} from '../liftosaurHistory'
import {
  empty,
  fixtures,
  gzclp,
  GZCLP_SESSIONS,
  inProgress,
  legacy,
  messy,
  MESSY_EXPECTATIONS,
  MESSY_NOTES,
  nonProgram,
  notAnExport,
  truncated,
} from './fixtures'

/** The importing user; the export carries no identity we would trust. */
const uid = 'user-1'

function run(input: unknown, options: { units?: 'kg' | 'lb'; includeInProgress?: boolean } = {}): ImportResult {
  return importLiftosaurHistory(input, { uid, ...options })
}

/** The one exercise of a session, by canonical name. */
function exercise(session: Session, name: string): { name: string; tier?: 1 | 2 | 3; sets: SetLog[] } {
  return session.exercises!.find((candidate) => candidate.name === name)!
}

function noteCount(result: ImportResult, reason: ReasonId): number {
  return result.report.notes.find((note) => note.reason === reason)?.count ?? 0
}

/** `'imported'`, the reason the record was skipped with, or `undefined` if neither. */
function outcomeOf(result: ImportResult, dayName: string): string | undefined {
  if (result.sessions.some((session) => session.programDay === dayName)) return 'imported'
  return result.report.skipped.find((skip) => skip.level === 'record' && skip.ref.includes(dayName))?.reason
}

describe('liftosaurHistory', () => {
  const result = run(gzclp)

  it('imports every finished workout with its date, program day and exercises', () => {
    expect(result.report.imported).toBe(GZCLP_SESSIONS.length)

    for (const [i, expected] of GZCLP_SESSIONS.entries()) {
      const session = result.sessions[i]
      expect(session, `${expected.date} ${expected.programDay}`).toMatchObject({
        uid,
        date: expected.date,
        kind: 'strength',
        status: 'done',
        programDay: expected.programDay,
        source: 'manual',
      })
      expect(session.exercises!.map((e) => e.name)).toEqual(expected.exercises)
    }
  })

  it('imports a clean export without a single skip', () => {
    expect(result.report.skipped).toEqual([])
  })

  it('keeps the Liftosaur record id inside the session id', () => {
    expect(result.sessions[0].id).toBe('liftosaur-1777896000042')
    // `externalId` is documented as the Strava activity id; overloading it with
    // a Liftosaur id would break Strava dedup.
    expect(result.sessions[0].externalId).toBeUndefined()
  })

  it('recovers the tier from the entry id prefix', () => {
    const [session] = result.sessions
    expect(exercise(session, 'Squat').tier).toBe(1)
    expect(exercise(session, 'Bench Press').tier).toBe(2)
    expect(exercise(session, 'Lat Pulldown').tier).toBe(3)
    expect(noteCount(result, 'tier-unrecoverable')).toBe(0)
  })

  it('reads a skipped set as completedReps 0 and an untouched one as null', () => {
    // Liftosaur has no `isSkipped`: a set the user deliberately dropped is
    // marked complete at zero reps, while an untouched set is simply not marked.
    const sets = exercise(result.sessions[0], 'Bench Press').sets
    expect(sets.map((set) => set.completedReps)).toEqual([10, 0, null])
  })

  it('keeps an AMRAP result that beat its target', () => {
    const sets = exercise(result.sessions[0], 'Squat').sets
    expect(sets).toHaveLength(5)
    expect(sets[4]).toMatchObject({ isAmrap: true, prescribedReps: 3, completedReps: 5 })
    expect(sets.slice(0, 4).every((set) => !set.isAmrap)).toBe(true)
  })

  it('keeps a missed AMRAP as a logged zero, not as an untouched set', () => {
    // The stage-3 T1 miss: ten prescribed singles, the last one failed.
    const sets = exercise(result.sessions[4], 'Squat').sets
    expect(sets).toHaveLength(10)
    expect(sets[9]).toMatchObject({ prescribedReps: 1, completedReps: 0, isAmrap: true })
    expect(sets[9].weight).toEqual({ value: 120, unit: 'kg' })
  })

  it('copies a rep range as the target reps plus the range minimum', () => {
    const sets = exercise(result.sessions[0], 'Lat Pulldown').sets
    expect(sets[0]).toMatchObject({ prescribedReps: 12, minReps: 8 })
  })

  it('converts a set logged in pounds into the profile units', () => {
    const sets = exercise(result.sessions[2], 'Lat Pulldown').sets
    expect(sets[0].weight).toEqual(convert(makeWeight(100, 'lb'), 'kg'))
    expect(sets[1].weight).toEqual({ value: 40, unit: 'kg' })
  })

  it('never turns a percentage into a weight', () => {
    // The set carries `originalWeight: 75%` next to an absolute 90 kg.
    const sets = exercise(result.sessions[2], 'Squat').sets
    for (const set of sets) expect(set.weight).toEqual({ value: 90, unit: 'kg' })
  })

  it('keeps a set label, which is what carries the 5RM retest marker', () => {
    const sets = exercise(result.sessions[5], 'Overhead Press').sets
    expect(sets).toHaveLength(1)
    expect(sets[0].label).toBe('5RM Test')
  })

  it('drops warmup sets and reports how many', () => {
    const sets = exercise(result.sessions[0], 'Squat').sets
    expect(sets.every((set) => set.prescribedReps === 3)).toBe(true)
    expect(noteCount(result, 'warmups-dropped')).toBe(2)
  })

  it('reports the units the export itself was written in', () => {
    expect(result.report.sourceUnits).toBe('kg')
  })

  it('converts every weight when the target profile uses the other unit', () => {
    const inPounds = run(gzclp, { units: 'lb' })
    for (const session of inPounds.sessions) {
      for (const logged of session.exercises!) {
        for (const set of logged.sets) expect(set.weight.unit).toBe('lb')
      }
    }
  })
})

describe('the export envelope', () => {
  it('accepts the bare storage object, a wrapper around it, and a bare history array', () => {
    const bare = run(gzclp)
    const wrapped = run({ storage: gzclp })
    const arrayOnly = run(gzclp.history)

    expect(wrapped.sessions).toEqual(bare.sessions)
    expect(arrayOnly.report.imported).toBe(bare.report.imported)
  })

  it('accepts the file as raw text', () => {
    expect(run(JSON.stringify(gzclp)).report.imported).toBe(6)
  })

  it('names the CSV export instead of reporting a parse error', () => {
    expect(run(notAnExport).report.failure).toBe(WRONG_EXPORT_MESSAGE)
  })

  it('never throws on a truncated file', () => {
    const failed = run(truncated)
    expect(failed.report.failure).toBe(NOT_AN_EXPORT_MESSAGE)
    expect(failed.sessions).toEqual([])
  })

  it('refuses anything that is not an export', () => {
    for (const input of [null, undefined, 42, 'hello', {}, { settings: {} }]) {
      expect(run(input).report.failure, JSON.stringify(input) ?? 'undefined').toBe(NOT_AN_EXPORT_MESSAGE)
    }
  })

  it('calls out a history that is not a list', () => {
    expect(run({ history: { '0': {} } }).report.failure).toBe(CORRUPT_HISTORY_MESSAGE)
  })

  it('imports an empty history as a success with zero sessions', () => {
    const result = run(empty)
    expect(result.report).toMatchObject({ imported: 0, skipped: [] })
    expect(result.report.failure).toBeUndefined()
  })
})

describe('tolerance', () => {
  const result = run(messy)

  it('puts every pathological record in the right bucket with the right reason', () => {
    for (const expected of MESSY_EXPECTATIONS) {
      expect(outcomeOf(result, expected.dayName), expected.dayName).toBe(expected.outcome)
    }
  })

  it('raises exactly the expected non-fatal notes', () => {
    for (const expected of MESSY_NOTES) {
      expect(noteCount(result, expected.reason), expected.reason).toBe(expected.count)
    }
    // The set as well as the counts: a note raised on data that does not deserve
    // one is a report the user cannot trust.
    expect(result.report.notes.map((note) => note.reason).sort()).toEqual(MESSY_NOTES.map((n) => n.reason).sort())
  })

  it('notes a workout that does not name its program day', () => {
    const session = result.sessions.find((candidate) => candidate.id === 'liftosaur-7777')!
    expect(session.programDay).toBeUndefined()
  })

  it('reads a lowercase rotation day back as the canonical GZCLP day', () => {
    // `deriveState` matches `GZCLP_ROTATION` with a strict `indexOf`, so a
    // lowercase `a1` that survived unnormalised would silently lose the cursor.
    expect(result.sessions.some((session) => session.programDay === 'A1')).toBe(true)
    expect(result.sessions.some((session) => session.programDay === 'a1')).toBe(false)
  })

  it('orders entries and sets by their declared index', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Scrambled')!
    // The record writes its entries 2, 1, 0 and the T1 sets 2, 0, 1.
    expect(session.exercises!.map((logged) => logged.name)).toEqual(['Squat', 'Bench Press', 'Lat Pulldown'])
    expect(exercise(session, 'Squat').sets.map((set) => set.prescribedReps)).toEqual([5, 4, 3])
  })

  it('falls back to array order for the whole record when one entry has no index', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Mixed Order')!
    expect(session.exercises!.map((logged) => logged.name)).toEqual(['Bench Press', 'Squat'])
  })

  it('reads a set marked complete with no rep count as a logged zero', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Logged Blank')!
    expect(session.exercises![0].sets.map((set) => set.completedReps)).toEqual([0, 5])
  })

  it('skips a start time that is not a representable instant', () => {
    // A finite number is not necessarily a date: beyond ±8.64e15 ms every field
    // of the `Date` reads NaN, and an ISO string built from it would throw in
    // every consumer that parses session dates.
    const outOfRange = run({
      history: [{ startTime: 1e18, dayName: 'A1', entries: [{ exercise: { id: 'squat' }, sets: [{ reps: 5 }] }] }],
    })
    expect(outOfRange.sessions).toEqual([])
    expect(outOfRange.report.skipped).toEqual([{ level: 'record', ref: 'record #1 A1', reason: 'no-usable-date' }])
  })

  it('prefers a readable `date` over a start time it cannot represent', () => {
    const recovered = run({
      history: [
        {
          startTime: 1e18,
          date: '2026-07-01T12:00:00.000Z',
          dayName: 'A1',
          entries: [{ exercise: { id: 'squat' }, sets: [{ reps: 5, weight: { value: 100, unit: 'kg' } }] }],
        },
      ],
    })
    expect(recovered.sessions[0].date).toBe('2026-07-01')
  })

  it('skips a record that is not an object at all', () => {
    const skip = result.report.skipped.find((entry) => entry.reason === 'malformed-record')
    expect(skip).toMatchObject({ level: 'record', ref: 'record #15' })
  })

  it('rolls the entry reasons up when a record loses all of its exercises', () => {
    const skip = result.report.skipped.find((entry) => entry.reason === 'all-entries-skipped')
    expect(skip!.detail).toBe('no-sets')
  })

  it('skips a set with no usable weight instead of importing a zero', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'No Weight')!
    // Three sets were logged: one with no weight at all, one with only a
    // percentage, one usable.
    expect(session.exercises![0].sets).toHaveLength(1)
    expect(session.exercises![0].sets[0].weight).toEqual({ value: 40, unit: 'kg' })
    expect(result.report.skipped.filter((skip) => skip.reason === 'no-weight')).toHaveLength(3)
  })

  it('falls through a null weight to the completed one', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Null Weight')!
    expect(session.exercises![0].sets).toHaveLength(1)
    expect(session.exercises![0].sets[0].weight).toEqual({ value: 45, unit: 'kg' })
  })

  it('reads a workout whose only date is the `date` string', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Bad Date')!
    expect(session.date).toBe('2026-07-01')
  })

  it('imports a workout in which nothing was completed, with every set untouched', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Zero Completed')!
    expect(session.exercises![0].sets.map((set) => set.completedReps)).toEqual([null, null, null])
  })

  it('defaults missing prescribed reps to the completed ones and drops a set with neither', () => {
    const sets = result.sessions.find((candidate) => candidate.programDay === 'Bad Reps')!.exercises![0].sets
    expect(sets[0]).toMatchObject({ prescribedReps: 11, completedReps: 11 })
    // An unreadable rep count is evidence of nothing, not of a zero.
    expect(sets[1]).toMatchObject({ prescribedReps: 12, completedReps: null })
    expect(result.report.skipped.some((skip) => skip.reason === 'no-reps')).toBe(true)
  })

  it('resolves a soft-deleted custom exercise by its stored name', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Deleted Custom')!
    expect(session.exercises![0].name).toBe('Front Squat')
  })

  it('keeps an unknown exercise under the name it was written with', () => {
    const session = result.sessions.find((candidate) => candidate.programDay === 'Unknown Exercise')!
    // Never substituted for another lift — that is exactly the CSV export's bug.
    expect(session.exercises![0].name).not.toBe('Squat')
    expect(result.report.notes.find((note) => note.reason === 'unknown-exercise')!.detail).toContain('9a7c0000')
  })

  it('gives two workouts that share an id distinct session ids', () => {
    const ids = result.sessions.filter((session) => session.id.startsWith('liftosaur-5150')).map((s) => s.id)
    expect(ids).toEqual(['liftosaur-5150', 'liftosaur-5150-2'])
  })

  it('locates every skip by date, day, exercise and set number', () => {
    for (const skip of result.report.skipped) {
      expect(skip.ref, skip.reason).toMatch(/\S/)
      if (skip.level === 'set') expect(skip.ref, skip.reason).toMatch(/ \/ set \d+$/)
    }
  })
})

describe('legacy exports', () => {
  const result = run(legacy, { units: 'kg' })

  it('applies the `add_is_completed` backfill rule to sets that predate the flag', () => {
    // Before March 2025 there was no `isCompleted`; the migration's own rule is
    // "a set with completedReps was done".
    const sets = result.sessions[0].exercises![0].sets
    expect(sets.map((set) => set.completedReps)).toEqual([3, 3, null])
  })

  it('falls back to the prescribed weight when no completed weight was ever written', () => {
    const sets = result.sessions[0].exercises![0].sets
    expect(sets[0].weight).toEqual(convert(makeWeight(225, 'lb'), 'kg'))
  })

  it('reports the tier as unrecoverable for every entry of a pre-2026 export', () => {
    for (const session of result.sessions) {
      for (const logged of session.exercises!) expect(logged.tier).toBeUndefined()
    }
    expect(noteCount(result, 'tier-unrecoverable')).toBe(3)
  })

  it('imports without a skip even though records, entries and sets carry no ids or vtypes', () => {
    expect(result.report.skipped).toEqual([])
    expect(result.report.imported).toBe(2)
  })
})

describe('unfinished workouts', () => {
  it('skips the progress array by default', () => {
    const result = run(inProgress)
    expect(result.report.imported).toBe(1)
    expect(result.report.skipped).toEqual([])
    expect(result.sessions[0].status).toBe('done')
  })

  it('imports the progress array on request, treating pre-filled reps as prescriptions', () => {
    const result = run(inProgress, { includeInProgress: true })
    expect(result.report.imported).toBe(2)

    const active = result.sessions[1]
    expect(active.status).toBe('active')
    // Only the third set was actually logged; the first two are pre-fill.
    expect(active.exercises![0].sets.map((set) => set.completedReps)).toEqual([null, null, 3])
    expect(noteCount(result, 'in-progress-imported')).toBe(1)
  })

  it('skips an unfinished record that leaked into the finished list', () => {
    const result = run(messy)
    expect(outcomeOf(result, 'Stray Progress')).toBe('in-progress')
  })
})

describe('reason wording', () => {
  it('has one message per reason and throws on an id it does not know', () => {
    for (const [id, message] of Object.entries(IMPORT_REASONS)) {
      expect(reasonMessage(id as ReasonId), id).toBe(message)
      expect(message, id).toMatch(/\.$/)
    }
    expect(() => reasonMessage('nonsense' as ReasonId)).toThrow()
  })
})

describe('totality', () => {
  const garbage: unknown[] = [
    null,
    undefined,
    0,
    '',
    '[',
    '{"history":',
    [],
    [null, 1, 'x'],
    { history: [null, [], 'x', { entries: 'nope' }, { entries: [{ exercise: null }] }] },
    { history: [{ startTime: 'yesterday', entries: [{ exercise: { id: 5 }, sets: [{}] }] }] },
    { storage: { history: [{ startTime: 1, entries: [{ exercise: { id: 'squat' }, sets: [1, 2] }] }] } },
    { history: [{ startTime: 1, dayName: 5, entries: [{ exercise: { id: 'squat' }, sets: [{ reps: {} }] }] }] },
    nonProgram,
    truncated,
    notAnExport,
  ]

  it('never throws, whatever it is handed', () => {
    for (const input of [...Object.values(fixtures), ...garbage]) {
      expect(() => run(input)).not.toThrow()
    }
  })

  it('always returns a report whose counts agree with the sessions it returns', () => {
    for (const input of [...Object.values(fixtures), ...garbage]) {
      const result = run(input)
      expect(result.report.imported).toBe(result.sessions.length)
      for (const session of result.sessions) {
        expect(session.uid).toBe(uid)
        expect(session.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(session.exercises!.length).toBeGreaterThan(0)
        for (const logged of session.exercises!) {
          expect(logged.sets.length).toBeGreaterThan(0)
          for (const set of logged.sets) {
            expect(Number.isFinite(set.prescribedReps)).toBe(true)
            expect(['kg', 'lb']).toContain(set.weight.unit)
          }
        }
      }
    }
  })
})

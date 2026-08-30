import { describe, expect, it } from 'vitest'

import type { Profile, Session, SetLog } from '@/types'

import { deleteConfirmCopy, describeSession, groupByMonth, isDeletable } from '../historyList'

const AUG_12 = '2026-08-12'
const AUG_13 = '2026-08-13'
const JUL_30 = '2026-07-30'

function profile(units: 'kg' | 'lb' = 'kg'): Profile {
  return {
    id: 'u1',
    email: 'a@b.c',
    settings: {
      units,
      barbellWeight: 20,
      plates: [{ weight: 20, count: 2 }],
      restTimers: { t1: 180, t2: 120, t3: 60 },
      comebackGapDays: 10,
      notifications: { daily: true, gapNudge: true },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5 },
    strengthTrack: { goal: { type: 'open' }, programText: '', programState: {}, rotationCursor: 0 },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run'],
      weeklyMinutes: 150,
      longestSessionMinutes: 90,
      mesoWeek: 1,
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: true, step: 6 },
  }
}

function set(weight: number, reps: number | null): SetLog {
  return { prescribedReps: 5, isAmrap: false, completedReps: reps, weight: { value: weight, unit: 'kg' } }
}

function strength(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    uid: 'u1',
    date: AUG_12,
    kind: 'strength',
    status: 'done',
    programDay: 'A1',
    exercises: [
      { name: 'Squat', tier: 1, sets: [set(100, 5), set(100, 5)] },
      { name: 'Bench Press', tier: 2, sets: [set(60, 10)] },
    ],
    ...overrides,
  }
}

function cardio(overrides: Partial<Session> = {}): Session {
  return {
    id: 'c1',
    uid: 'u1',
    date: AUG_12,
    kind: 'cardio',
    status: 'done',
    prescription: { modality: 'run', kind: 'easy', targetMinutes: 40, zone: 2 },
    minutes: 40,
    distanceKm: 8.2,
    rpe: 5,
    ...overrides,
  }
}

describe('describeSession', () => {
  it('names a strength session by its program day and sums what was moved', () => {
    const entry = describeSession(strength(), profile())

    expect(entry.title).toBe('Strength A1')
    // 100×5 + 100×5 + 60×10 = 1600 kg
    expect(entry.subtitle).toBe('2 lifts · 1600 kg')
    expect(entry.human).toBe('Wed, 12 Aug 2026')
    expect(entry.isActive).toBe(false)
    expect(entry.restoresState).toBe(false)
  })

  it('counts only completed reps towards the tonnage', () => {
    const entry = describeSession(
      strength({ exercises: [{ name: 'Squat', tier: 1, sets: [set(100, 5), set(100, null)] }] }),
      profile(),
    )

    expect(entry.subtitle).toBe('1 lift · 500 kg')
  })

  it('reports a strength session with nothing logged without a tonnage', () => {
    const entry = describeSession(
      strength({ exercises: [{ name: 'Squat', tier: 1, sets: [set(100, null)] }] }),
      profile(),
    )

    expect(entry.subtitle).toBe('1 lift')
  })

  it('names a cardio session by kind, modality and the minutes actually logged', () => {
    const entry = describeSession(cardio({ minutes: 46 }), profile())

    expect(entry.title).toBe('Easy run 46 min')
    expect(entry.subtitle).toBe('8.2 km · RPE 5')
  })

  it('falls back to the prescribed minutes, then to nothing at all', () => {
    expect(describeSession(cardio({ minutes: undefined }), profile()).title).toBe('Easy run 40 min')
    expect(describeSession(cardio({ minutes: undefined, prescription: undefined }), profile()).title).toBe('Cardio')
  })

  it('flags an active session and a session that carries program state', () => {
    const entry = describeSession(strength({ status: 'active', stateSnapshot: {} }), profile())

    expect(entry.isActive).toBe(true)
    expect(entry.restoresState).toBe(true)
  })
})

describe('groupByMonth', () => {
  it('groups newest first, both between and within groups', () => {
    const groups = groupByMonth(
      [strength({ id: 'a', date: JUL_30 }), strength({ id: 'b', date: AUG_12 }), cardio({ id: 'c', date: AUG_13 })],
      profile(),
    )

    expect(groups.map((group) => group.key)).toEqual(['2026-08', '2026-07'])
    expect(groups[0].label).toBe('August 2026')
    expect(groups[1].label).toBe('July 2026')
    expect(groups[0].entries.map((entry) => entry.session.id)).toEqual(['c', 'b'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupByMonth([], profile())).toEqual([])
  })
})

describe('isDeletable', () => {
  it('is true only for the single newest session', () => {
    const older = strength({ id: 'a', date: JUL_30 })
    const newest = strength({ id: 'b', date: AUG_12 })

    expect(isDeletable(newest, [older, newest])).toBe(true)
    expect(isDeletable(older, [older, newest])).toBe(false)
  })

  it('breaks a same-day tie deterministically, whatever order the list arrives in', () => {
    const morning = strength({ id: 'a', date: AUG_12, createdAt: new Date('2026-08-12T07:00:00Z') })
    const evening = cardio({ id: 'b', date: AUG_12, createdAt: new Date('2026-08-12T19:00:00Z') })

    expect(isDeletable(evening, [morning, evening])).toBe(true)
    expect(isDeletable(evening, [evening, morning])).toBe(true)
    expect(isDeletable(morning, [morning, evening])).toBe(false)
  })

  it('breaks a same-day tie on id, matching Firestore’s implicit __name__ order', () => {
    const lift = strength({ id: 'f21b', date: AUG_12, createdAt: new Date('2026-08-12T09:00:00Z') })
    const run = cardio({ id: '0a3f', date: AUG_12, createdAt: new Date('2026-08-12T18:00:00Z') })

    expect(isDeletable(lift, [run, lift])).toBe(true)
    expect(isDeletable(run, [run, lift])).toBe(false)
  })

  it('lets an active session be the newest — loadLatestSession ignores status', () => {
    const done = strength({ id: 'a', date: JUL_30 })
    const active = strength({ id: 'b', date: AUG_12, status: 'active' })

    expect(isDeletable(active, [done, active])).toBe(true)
  })

  it('is true for the only session in a single-session list', () => {
    const only = strength({ id: 'a' })

    expect(isDeletable(only, [only])).toBe(true)
  })

  it('is false against an empty list', () => {
    expect(isDeletable(strength(), [])).toBe(false)
  })
})

describe('deleteConfirmCopy', () => {
  it('promises the restore only when the session carries a snapshot', () => {
    const copy = deleteConfirmCopy(describeSession(strength({ stateSnapshot: {} }), profile()))

    expect(copy.title).toBe('Delete A1 of 12 Aug?')
    expect(copy.content).toContain('goes back to the weights it had before it')
    expect(copy.content).toContain('from 12 Aug')
    expect(copy.confirmLabel).toBe('Delete and restore')
  })

  it('promises nothing when there is no snapshot to restore', () => {
    const copy = deleteConfirmCopy(describeSession(cardio(), profile()))

    expect(copy.title).toBe('Delete the easy run of 12 Aug?')
    expect(copy.content).toContain('Nothing about your program changes')
    expect(copy.content).not.toContain('goes back')
    expect(copy.confirmLabel).toBe('Delete')
  })

  it('words a snapshot-less strength session from its own program day', () => {
    const copy = deleteConfirmCopy(describeSession(strength(), profile()))

    expect(copy.title).toBe('Delete the A1 session of 12 Aug?')
    expect(copy.confirmLabel).toBe('Delete')
  })
})

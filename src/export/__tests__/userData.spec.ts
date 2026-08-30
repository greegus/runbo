import type { BodyweightEntry, ExerciseState, Profile, Session } from '@/types'

import { buildExport, exportFileName } from '../userData'

function makeProfile(programState: Record<string, ExerciseState> = {}): Profile {
  return {
    id: 'uid-1',
    email: 'athlete@example.com',
    settings: {
      units: 'kg',
      barbellWeight: 20,
      plates: [{ weight: 20, count: 4 }],
      restTimers: { t1: 180, t2: 120, t3: 60 },
      comebackGapDays: 10,
      notifications: { daily: false, gapNudge: false },
      fcmTokens: [],
    },
    availability: { daysPerWeek: 5, preferredDays: [0, 1, 2, 4, 5], longSessionDay: 5 },
    strengthTrack: { goal: { type: 'open' }, programText: 'T1: Squat / 5x3+ / 100kg', programState, rotationCursor: 0 },
    cardioTrack: {
      goal: { type: 'open' },
      modalities: ['run'],
      weeklyMinutes: 120,
      longestSessionMinutes: 60,
      mesoWeek: 1,
      holdStreak: 0,
      rotationCursor: 0,
      lastPlannedMinutes: 0,
    },
    onboarding: { completed: true, step: 6 },
    createdAt: new Date('2026-01-01T08:00:00.000Z'),
  }
}

function session(id: string, date: string, extra: Partial<Session> = {}): Session {
  return { id, uid: 'uid-1', date, kind: 'strength', status: 'done', ...extra }
}

function entry(id: string, date: string, weight: number): BodyweightEntry {
  return { id, uid: 'uid-1', date, weight }
}

const STATE: ExerciseState = { weights: [{ value: 100, unit: 'kg' }], setVariationIndex: 1, state: {} }

describe('buildExport', () => {
  it('sorts sessions and weigh-ins oldest first and counts what it shipped', () => {
    const bundle = buildExport(
      makeProfile({ 'T1:Squat': STATE, 'T2:Bench Press': STATE }),
      [session('c', '2026-03-04'), session('a', '2026-01-05'), session('b', '2026-02-02')],
      [entry('y', '2026-02-01', 81), entry('x', '2026-01-01', 80)],
      '2026-08-30',
    )

    expect(bundle.schema).toBe('runbo.export.v1')
    expect(bundle.exportedOn).toBe('2026-08-30')
    expect(bundle.sessions.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(bundle.bodyweight.map((item) => item.id)).toEqual(['x', 'y'])
    expect(bundle.counts).toEqual({ sessions: 3, bodyweightEntries: 2, lifts: 2 })
  })

  it('orders two sessions on one day by createdAt, then by id', () => {
    const bundle = buildExport(
      makeProfile(),
      [
        session('z', '2026-03-04', { kind: 'cardio', createdAt: new Date('2026-03-04T18:00:00.000Z') }),
        session('a', '2026-03-04', { createdAt: new Date('2026-03-04T07:00:00.000Z') }),
        session('m', '2026-03-04'),
      ],
      [],
      '2026-08-30',
    )

    // The undated one first (0 ms), then the morning lift, then the evening run.
    expect(bundle.sessions.map((item) => item.id)).toEqual(['m', 'a', 'z'])
  })

  it('does not mutate or alias the caller’s arrays', () => {
    const sessions = [session('b', '2026-02-02'), session('a', '2026-01-05')]
    const bundle = buildExport(makeProfile(), sessions, [], '2026-08-30')

    expect(sessions.map((item) => item.id)).toEqual(['b', 'a'])
    expect(bundle.sessions).not.toBe(sessions)
  })

  it('keeps the state snapshot and active sessions — the backup strips nothing', () => {
    const snapshot = { 'T1:Squat': STATE }
    const bundle = buildExport(
      makeProfile(),
      [
        session('a', '2026-01-05', { stateSnapshot: snapshot, programDay: 'A1' }),
        session('b', '2026-01-07', { status: 'active' }),
      ],
      [],
      '2026-08-30',
    )

    expect(bundle.sessions[0].stateSnapshot).toEqual(snapshot)
    expect(bundle.sessions[1].status).toBe('active')
  })

  it('survives JSON.stringify, timestamps included', () => {
    const bundle = buildExport(
      makeProfile({ 'T1:Squat': STATE }),
      [session('a', '2026-01-05', { createdAt: new Date('2026-01-05T09:30:00.000Z') })],
      [entry('x', '2026-01-01', 80)],
      '2026-08-30',
    )

    const roundTripped = JSON.parse(JSON.stringify(bundle))

    expect(roundTripped.sessions[0].createdAt).toBe('2026-01-05T09:30:00.000Z')
    expect(roundTripped.profile.createdAt).toBe('2026-01-01T08:00:00.000Z')
    expect(roundTripped.counts.lifts).toBe(1)
  })
})

describe('exportFileName', () => {
  it('names the file after the day it was taken', () => {
    expect(exportFileName('2026-08-30')).toBe('runbo-export-2026-08-30.json')
  })
})

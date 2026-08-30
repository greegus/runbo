import type { CardioPrescription, Session } from '@/types'

import {
  cardioLogBlockedReason,
  cardioLogPatch,
  cardioLogWarnings,
  emptyCardioLogDraft,
  fromSession,
} from '../cardioLog'

const prescription: CardioPrescription = { modality: 'run', kind: 'easy', targetMinutes: 40, zone: 2 }

function session(patch: Partial<Session> = {}): Session {
  return { id: 's1', uid: 'u1', date: '2026-08-24', kind: 'cardio', status: 'active', ...patch }
}

describe('emptyCardioLogDraft', () => {
  it('seeds minutes from the prescription target', () => {
    expect(emptyCardioLogDraft(prescription)).toEqual({
      minutes: 40,
      distanceKm: null,
      avgHr: null,
      rpe: null,
      notes: '',
    })
  })

  it('leaves minutes empty without a prescription, and never seeds a zero target', () => {
    expect(emptyCardioLogDraft().minutes).toBeNull()
    expect(emptyCardioLogDraft({ ...prescription, targetMinutes: 0 }).minutes).toBeNull()
  })
})

describe('fromSession', () => {
  it('rehydrates recorded values and maps missing ones to null', () => {
    expect(fromSession(session({ minutes: 42, distanceKm: 8.1, notes: 'windy' }))).toEqual({
      minutes: 42,
      distanceKm: 8.1,
      avgHr: null,
      rpe: null,
      notes: 'windy',
    })
  })
})

describe('cardioLogBlockedReason', () => {
  it('asks for minutes when there is no usable number', () => {
    const base = emptyCardioLogDraft()

    expect(cardioLogBlockedReason(base)).toBe('Enter how many minutes you did')
    expect(cardioLogBlockedReason({ ...base, minutes: 0 })).toBe('Enter how many minutes you did')
    expect(cardioLogBlockedReason({ ...base, minutes: -5 })).toBe('Enter how many minutes you did')
    expect(cardioLogBlockedReason({ ...base, minutes: Number.NaN })).toBe('Enter how many minutes you did')
  })

  it('blocks on nothing else — a watchless run is still a session', () => {
    expect(cardioLogBlockedReason({ minutes: 40, distanceKm: null, avgHr: null, rpe: null, notes: '' })).toBeNull()
  })
})

describe('cardioLogWarnings', () => {
  it('is silent on ordinary values', () => {
    expect(cardioLogWarnings({ minutes: 40, distanceKm: 8, avgHr: 141, rpe: 4, notes: '' })).toEqual([])
  })

  it('questions absurd values instead of clamping them', () => {
    const warnings = cardioLogWarnings({ minutes: 900, distanceKm: -3, avgHr: 500, rpe: 12, notes: '' })

    expect(warnings).toHaveLength(4)
    expect(warnings[1]).toContain('negative')
  })
})

describe('cardioLogPatch', () => {
  it('always carries whole, non-negative minutes', () => {
    expect(cardioLogPatch({ minutes: 41.6, distanceKm: null, avgHr: null, rpe: null, notes: '' })).toEqual({
      minutes: 42,
    })
    expect(cardioLogPatch({ minutes: -9, distanceKm: null, avgHr: null, rpe: null, notes: '' }).minutes).toBe(0)
  })

  it('omits absent keys rather than setting them undefined — Firestore rejects undefined', () => {
    const patch = cardioLogPatch({ minutes: 40, distanceKm: 0, avgHr: null, rpe: null, notes: '   ' })

    expect(Object.keys(patch)).toEqual(['minutes'])
    expect('distanceKm' in patch).toBe(false)
    expect('notes' in patch).toBe(false)
  })

  it('keeps every recorded optional value and trims the notes', () => {
    expect(cardioLogPatch({ minutes: 40, distanceKm: 8.1, avgHr: 141, rpe: 4, notes: '  windy  ' })).toEqual({
      minutes: 40,
      distanceKm: 8.1,
      avgHr: 141,
      rpe: 4,
      notes: 'windy',
    })
  })
})

import type { Session } from '@/types'

import { DEFAULT_MULTISPORT, isMultisportVisit, multisportMonth, shiftMonth } from '../multisport'

function session(date: string, patch: Partial<Session> = {}): Session {
  return { id: `${date}-${patch.kind ?? 'strength'}`, uid: 'u', date, kind: 'strength', status: 'done', ...patch }
}

const swim = { modality: 'swim' as const, kind: 'easy' as const, targetMinutes: 40, zone: 2 as const }
const run = { ...swim, modality: 'run' as const }

describe('isMultisportVisit', () => {
  it('counts the gym, the pool and the sauna — finished, and not marked off the card', () => {
    expect(isMultisportVisit(session('2026-11-02'))).toBe(true)
    expect(isMultisportVisit(session('2026-11-02', { kind: 'sauna' }))).toBe(true)
    expect(isMultisportVisit(session('2026-11-02', { kind: 'cardio', prescription: swim }))).toBe(true)
  })

  it('does not count a run, a session still running, or one marked as not paid with the card', () => {
    expect(isMultisportVisit(session('2026-11-02', { kind: 'cardio', prescription: run }))).toBe(false)
    expect(isMultisportVisit(session('2026-11-02', { status: 'active' }))).toBe(false)
    expect(isMultisportVisit(session('2026-11-02', { multisport: false }))).toBe(false)
  })
})

describe('multisportMonth', () => {
  it('breaks even on the 8th entry at 1150 a month and 150 an entry', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => session(`2026-11-0${i + 1}`))
    const seven = multisportMonth(sessions, '2026-11', DEFAULT_MULTISPORT)

    expect(seven).toMatchObject({ entries: 7, value: 1050, breakEvenEntries: 8, remaining: 1, balance: -100 })

    const eight = multisportMonth([...sessions, session('2026-11-09')], '2026-11', DEFAULT_MULTISPORT)
    expect(eight).toMatchObject({ entries: 8, value: 1200, remaining: 0, balance: 50 })
  })

  it('counts a day once, so a sauna after the gym is one entry', () => {
    const month = multisportMonth(
      [session('2026-11-02'), session('2026-11-02', { kind: 'sauna' })],
      '2026-11',
      DEFAULT_MULTISPORT,
    )

    expect(month.entries).toBe(1)
  })

  it('counts only the calendar month asked for', () => {
    const month = multisportMonth(
      [session('2026-10-31'), session('2026-11-01'), session('2026-12-01')],
      '2026-11',
      DEFAULT_MULTISPORT,
    )

    expect(month.days).toEqual(['2026-11-01'])
  })
})

describe('shiftMonth', () => {
  it('steps across the year boundary both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 0)).toBe('2026-11')
  })
})

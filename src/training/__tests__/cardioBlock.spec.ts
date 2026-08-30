import type { Profile, Session } from '@/types'
import { addDays } from '@/utils/date'

import { BLOCK_LENGTH, blockRatio, blockWindowStart, type CardioBlockAction, cardioBlockAction } from '../cardioBlock'

type CardioTrack = Profile['cardioTrack']

const BLOCK = '2026-03-02' // a Monday
const PREVIOUS = addDays(BLOCK, -BLOCK_LENGTH)

function track(overrides: Partial<CardioTrack> = {}): CardioTrack {
  return {
    goal: { type: 'open' },
    modalities: ['run'],
    weeklyMinutes: 150,
    longestSessionMinutes: 90,
    mesoWeek: 1,
    blockStartDate: BLOCK,
    holdStreak: 0,
    rotationCursor: 0,
    lastPlannedMinutes: 150,
    ...overrides,
  }
}

function strength(date: string, status: Session['status'] = 'done'): Session {
  return { id: `s-${date}`, uid: 'u1', date, kind: 'strength', status, programDay: 'A1' }
}

function cardio(date: string, minutes: number): Session {
  return { id: `c-${date}`, uid: 'u1', date, kind: 'cardio', status: 'done', minutes }
}

/**
 * A profile written before `blockStartDate` existed. `mesoStartDate` is gone from
 * `Profile`, so the legacy branch is fed the way Firestore feeds it: an extra
 * field on the stored object that the type does not describe.
 */
function legacyTrack(mesoStartDate: unknown, overrides: Partial<CardioTrack> = {}): CardioTrack {
  return { ...track({ blockStartDate: null, ...overrides }), mesoStartDate } as CardioTrack
}

/** What the store writes: the anchor moves, and only an `advance` touches the rest. */
function anchor(current: CardioTrack, action: CardioBlockAction): CardioTrack {
  return action.kind === 'idle' ? current : { ...current, blockStartDate: action.to }
}

describe('blockWindowStart', () => {
  it('prefers the stored anchor', () => {
    expect(blockWindowStart(legacyTrack(BLOCK, { blockStartDate: '2026-03-09', mesoWeek: 1 }))).toBe('2026-03-09')
  })

  it('reproduces the legacy derivation exactly for a profile written before the field', () => {
    // This is character for character what the profile store's `plannedWeekOf`
    // computed: `mesoStartDate` is block 1's Monday and `mesoWeek` counts from
    // there. A profile that predates `blockStartDate` therefore translates with
    // no migration and no change of meaning.
    for (const mesoWeek of [1, 2, 3, 4]) {
      const legacy = legacyTrack(BLOCK, { mesoWeek })
      const plannedWeekOf = addDays(BLOCK, BLOCK_LENGTH * (Math.max(1, mesoWeek) - 1))

      expect(blockWindowStart(legacy)).toBe(plannedWeekOf)
    }
  })

  it('is null when no block has ever been opened', () => {
    expect(blockWindowStart(track({ blockStartDate: null }))).toBeNull()
  })

  it('reads a malformed legacy anchor as no block rather than throwing', () => {
    // The legacy field is untyped data off the wire — a hand-edited or imported
    // document can carry anything. `addDays` would throw and take a view down;
    // "no block yet" is a state the planner already understands.
    for (const malformed of ['', 'not-a-date', '2026-02-30', 42, null, undefined]) {
      expect(blockWindowStart(legacyTrack(malformed))).toBeNull()
    }
  })
})

describe('cardioBlockAction — opening the first block', () => {
  const fresh = track({ blockStartDate: null })

  it('does nothing at all before the first session', () => {
    expect(cardioBlockAction(fresh, [], BLOCK)).toEqual({ kind: 'idle' })
  })

  it('opens the block on the Monday of the week the first session fell in', () => {
    // Wednesday. The anchor is the Monday, so the Saturday long run three days
    // later belongs to the same block instead of opening a second one.
    const wednesday = addDays(BLOCK, 2)

    expect(cardioBlockAction(fresh, [strength(wednesday)], wednesday)).toEqual({
      kind: 'start',
      from: null,
      to: BLOCK,
    })
  })

  it('ignores sessions that are unfinished or still in the future', () => {
    const sessions = [strength(addDays(BLOCK, 1), 'active'), strength(addDays(BLOCK, 30))]

    expect(cardioBlockAction(fresh, sessions, addDays(BLOCK, 2))).toEqual({ kind: 'idle' })
  })
})

describe('cardioBlockAction — a block that is still running', () => {
  it('stays idle on every day of the block', () => {
    const sessions = [strength(BLOCK), cardio(addDays(BLOCK, 1), 60)]

    for (let offset = 0; offset < BLOCK_LENGTH; offset += 1) {
      expect(cardioBlockAction(track(), sessions, addDays(BLOCK, offset))).toEqual({ kind: 'idle' })
    }
  })
})

describe('cardioBlockAction — a block that was trained in', () => {
  const today = addDays(BLOCK, BLOCK_LENGTH)

  it('advances one block on day seven', () => {
    const action = cardioBlockAction(track(), [strength(addDays(BLOCK, 3))], today)

    expect(action).toMatchObject({ kind: 'advance', from: BLOCK, to: today })
  })

  it('advances on a strength-only block, and scores the missed cardio as a miss', () => {
    // The gate is any completed session, not a cardio one: someone who lifted
    // three times and skipped every run genuinely missed their cardio, and the
    // volume SHOULD hold.
    const sessions = [strength(addDays(PREVIOUS, 1)), strength(addDays(BLOCK, 1))]
    const action = cardioBlockAction(track(), sessions, today)

    expect(action).toMatchObject({ kind: 'advance', ratio: 0 })
  })

  it('divides by what the previous block was prescribed, not by the baseline', () => {
    // A deload prescribes 60 % of the baseline. Measured against the baseline a
    // perfectly completed deload scores ~0.5 and holds the block after it for
    // no reason.
    const deloaded = track({ weeklyMinutes: 150, lastPlannedMinutes: 90 })
    const sessions = [cardio(addDays(PREVIOUS, 2), 90), strength(addDays(BLOCK, 1))]

    expect(blockRatio(deloaded, sessions)).toBe(1)
    expect(cardioBlockAction(deloaded, sessions, today)).toMatchObject({ kind: 'advance', ratio: 1 })
  })

  it('treats a profile with nothing logged before the block as fully done', () => {
    expect(blockRatio(track(), [cardio(addDays(BLOCK, 1), 10)])).toBe(1)
  })

  it('treats an empty previous block as an absence, not as a missed block', () => {
    // Nothing at all in the window before this one. `skip` refused to move the
    // block for it; scoring it here would be the same event punished twice.
    const sessions = [strength(addDays(PREVIOUS, -10)), strength(addDays(BLOCK, 1))]

    expect(blockRatio(track(), sessions)).toBe(1)
  })
})

describe('cardioBlockAction — a block nobody trained in', () => {
  const mesocycle = { mesoWeek: 3, weeklyMinutes: 175, holdStreak: 1, lastPlannedMinutes: 162 }

  it('re-anchors onto the current window and changes nothing else', () => {
    const current = track(mesocycle)
    const action = cardioBlockAction(current, [strength(addDays(BLOCK, -3))], addDays(BLOCK, BLOCK_LENGTH))

    expect(action).toEqual({ kind: 'skip', from: BLOCK, to: addDays(BLOCK, BLOCK_LENGTH) })

    const after = anchor(current, action)
    expect(after.mesoWeek).toBe(3)
    expect(after.weeklyMinutes).toBe(175)
    expect(after.holdStreak).toBe(1)
    expect(after.lastPlannedMinutes).toBe(162)
  })

  it('answers a 40-day absence with exactly one skip', () => {
    // Five and a half empty windows. Stepping through them one at a time would
    // be five writes and — worse — five chances for the mesocycle to move; the
    // athlete comes back to the block they left, on the window they are in.
    const current = track(mesocycle)
    const today = addDays(BLOCK, 40)
    const sessions = [strength(addDays(BLOCK, -3))]

    const action = cardioBlockAction(current, sessions, today)

    expect(action).toEqual({ kind: 'skip', from: BLOCK, to: addDays(BLOCK, 35) })
    expect(cardioBlockAction(anchor(current, action), sessions, today)).toEqual({ kind: 'idle' })

    // Provably untouched: the whole mesocycle, field by field.
    expect(anchor(current, action)).toEqual({ ...current, blockStartDate: addDays(BLOCK, 35) })
  })

  it('leaves the volume where it was when the athlete comes back', () => {
    // The block that was skipped holds no session, so the block after it is not
    // scored as a miss either — no hold, no 10 % step back, and `comeback.ts` is
    // left to answer the absence on its own.
    const current = track(mesocycle)
    const today = addDays(BLOCK, 40)
    const after = anchor(current, cardioBlockAction(current, [strength(addDays(BLOCK, -3))], today))

    expect(blockRatio(after, [strength(addDays(BLOCK, -3))])).toBe(1)
  })
})

describe('cardioBlockAction — an absence with training in the middle', () => {
  it('stops at the first window that was trained instead of stepping over it', () => {
    // Window 1 empty, window 2 trained, and the athlete opens the app in window
    // 4. Jumping straight to the current window would pass over window 2 — a
    // window whose volume never progressed and whose completion never counted.
    const sessions = [strength(addDays(BLOCK, BLOCK_LENGTH + 2))]
    const action = cardioBlockAction(track(), sessions, addDays(BLOCK, BLOCK_LENGTH * 3 + 1))

    expect(action).toEqual({ kind: 'skip', from: BLOCK, to: addDays(BLOCK, BLOCK_LENGTH) })

    // And the next pass, from there, advances that trained window rather than
    // skipping it too.
    const next = cardioBlockAction(
      track({ blockStartDate: addDays(BLOCK, BLOCK_LENGTH) }),
      sessions,
      addDays(BLOCK, BLOCK_LENGTH * 3 + 1),
    )

    expect(next.kind).toBe('advance')
  })

  it('still collapses a wholly empty absence into one skip', () => {
    const action = cardioBlockAction(track(), [strength(addDays(BLOCK, -3))], addDays(BLOCK, BLOCK_LENGTH * 5 + 2))

    expect(action).toEqual({ kind: 'skip', from: BLOCK, to: addDays(BLOCK, BLOCK_LENGTH * 5) })
  })
})

describe('cardioBlockAction — idempotence', () => {
  it('has nothing left to do once the action is applied', () => {
    const fresh = track({ blockStartDate: null })
    const sessions = [strength(addDays(BLOCK, 2)), cardio(addDays(BLOCK, 4), 150)]

    const start = cardioBlockAction(fresh, sessions, addDays(BLOCK, 2))
    expect(start.kind).toBe('start')
    expect(cardioBlockAction(anchor(fresh, start), sessions, addDays(BLOCK, 2))).toEqual({ kind: 'idle' })

    const today = addDays(BLOCK, BLOCK_LENGTH)
    const advance = cardioBlockAction(anchor(fresh, start), sessions, today)
    expect(advance.kind).toBe('advance')
    expect(cardioBlockAction(anchor(fresh, advance), sessions, today)).toEqual({ kind: 'idle' })
  })
})

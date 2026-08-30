import type { Modality } from '@/types'

import { growLongestSession, planCardioWeek, type CardioTrackState, type CardioWeekPlan } from '../cardioPlan'

function track(overrides: Partial<CardioTrackState> = {}): CardioTrackState {
  return {
    goal: { type: 'open' },
    modalities: ['run', 'bike', 'swim'],
    weeklyMinutes: 150,
    longestSessionMinutes: 60,
    mesoWeek: 1,
    holdStreak: 0,
    rotationCursor: 0,
    lastPlannedMinutes: 0,
    ...overrides,
  }
}

/** What the caller persists after each week — the whole point of the return value. */
function advance(state: CardioTrackState, plan: CardioWeekPlan): CardioTrackState {
  return {
    ...state,
    weeklyMinutes: plan.nextBaseline,
    mesoWeek: plan.nextMesoWeek,
    holdStreak: plan.holdStreak,
    rotationCursor: plan.rotationCursor,
  }
}

/** The plan's own floor for an easy session — nothing shorter is worth the shoes. */
const MIN_SESSION = 20

function totalMinutes(plan: CardioWeekPlan): number {
  return plan.sessions.reduce((sum, session) => sum + session.targetMinutes, 0)
}

describe('planCardioWeek — two mesocycles', () => {
  const weeks: CardioWeekPlan[] = []
  // A generous longest-session so the per-session ceiling never binds: this
  // block is about the volume ramp, and a capped week would test the cap.
  let state = track({ longestSessionMinutes: 120 })

  beforeAll(() => {
    for (let week = 0; week < 8; week += 1) {
      const plan = planCardioWeek(state, 1, 3)

      weeks.push(plan)
      state = advance(state, plan)
    }
  })

  it('ramps by 8 % for three weeks, then deloads to 60 %', () => {
    expect(weeks.map((plan) => plan.weeklyMinutes)).toEqual([150, 162, 175, 90, 175, 189, 204, 105])
  })

  it('flags exactly the two deload weeks', () => {
    expect(weeks.map((plan) => plan.isDeload)).toEqual([false, false, false, true, false, false, false, true])
  })

  it('rolls week 3 volume into the next baseline after the deload', () => {
    expect(weeks[3].nextBaseline).toBe(175)
    expect(weeks[3].nextMesoWeek).toBe(1)
    expect(weeks[7].nextBaseline).toBe(204)
  })

  it('keeps the session minutes summing exactly to the weekly total', () => {
    for (const plan of weeks) {
      expect(totalMinutes(plan)).toBe(plan.weeklyMinutes)
      expect(plan.sessions.every((session) => Number.isInteger(session.targetMinutes))).toBe(true)
    }
  })

  it('never repeats a modality back to back, across week boundaries too', () => {
    const sequence: Modality[] = weeks.flatMap((plan) => plan.sessions.map((session) => session.modality))

    for (let index = 1; index < sequence.length; index += 1) {
      expect(sequence[index]).not.toBe(sequence[index - 1])
    }
  })

  it('never gives the long session to swimming while other modalities exist', () => {
    for (const plan of weeks) {
      const long = plan.sessions.find((session) => session.kind === 'long')!

      expect(long.modality).not.toBe('swim')
    }
  })

  it('is deterministic: same state in, same plan out', () => {
    expect(planCardioWeek(track(), 1, 3)).toEqual(planCardioWeek(track(), 1, 3))
  })
})

describe('adaptive hold', () => {
  it('repeats last week volume and does not advance the mesocycle week', () => {
    const plan = planCardioWeek(track({ mesoWeek: 3 }), 0.5, 3)

    expect(plan.weeklyMinutes).toBe(162) // week 2's volume, run again
    expect(plan.nextMesoWeek).toBe(3)
    expect(plan.nextBaseline).toBe(150)
    expect(plan.holdStreak).toBe(1)
    expect(plan.isDeload).toBe(false)
  })

  it('steps the baseline back 10 % on the second miss in a row', () => {
    const held = planCardioWeek(track({ mesoWeek: 3 }), 0.5, 3)
    const stepped = planCardioWeek(advance(track({ mesoWeek: 3 }), held), 0.6, 3)

    expect(stepped.nextBaseline).toBe(135) // 150 x 0.9
    expect(stepped.weeklyMinutes).toBe(157) // mesocycle restarts at week 3 off the new baseline
    expect(stepped.nextMesoWeek).toBe(4)
    expect(stepped.holdStreak).toBe(0)
  })

  it('holds at the baseline when the very first week is missed', () => {
    const plan = planCardioWeek(track({ mesoWeek: 1 }), 0, 3)

    expect(plan.weeklyMinutes).toBe(150)
    expect(plan.nextMesoWeek).toBe(1)
    expect(plan.holdStreak).toBe(1)
  })

  it('repeats what was actually prescribed, not what the mesocycle week implies', () => {
    // The week after a deload: `mesoWeek` is already back at 1 and the baseline
    // has been rolled up to the week-3 volume, so deriving the held volume from
    // the mesocycle week prescribed 175 minutes to someone who had just skipped
    // a 90-minute deload week.
    const plan = planCardioWeek(track({ mesoWeek: 1, weeklyMinutes: 175, lastPlannedMinutes: 90 }), 0, 3)

    expect(plan.weeklyMinutes).toBe(90)
    expect(plan.nextMesoWeek).toBe(1)
    expect(plan.holdStreak).toBe(1)
  })

  it('treats 70 % as completed', () => {
    const plan = planCardioWeek(track({ mesoWeek: 2 }), 0.7, 3)

    expect(plan.weeklyMinutes).toBe(162)
    expect(plan.holdStreak).toBe(0)
    expect(plan.nextMesoWeek).toBe(3)
  })
})

describe('session split', () => {
  it('adds an intervals session once the week reaches 120 minutes', () => {
    const big = planCardioWeek(track(), 1, 3)
    const small = planCardioWeek(track({ weeklyMinutes: 100 }), 1, 3)

    expect(big.sessions.map((session) => session.kind)).toEqual(['long', 'intervals', 'easy'])
    expect(big.sessions[1]).toMatchObject({
      kind: 'intervals',
      zone: 4,
      structure: { reps: 6, workMinutes: 3, restMinutes: 2 },
    })
    expect(small.sessions.some((session) => session.kind === 'intervals')).toBe(false)
  })

  it('splits 150 minutes into 40 % long, 25 % intervals, rest easy', () => {
    const plan = planCardioWeek(track(), 1, 3)

    expect(plan.sessions.map((session) => session.targetMinutes)).toEqual([60, 38, 52])
    expect(plan.sessions.filter((session) => session.kind !== 'intervals').every((session) => session.zone === 2)).toBe(
      true,
    )
  })

  it('caps EVERY session at 110 % of the longest session so far, not just the long one', () => {
    const plan = planCardioWeek(track({ weeklyMinutes: 200, longestSessionMinutes: 40 }), 1, 5)

    // 44 is the ceiling; 200 fits under it across five days, so the 40/25 split
    // is trimmed and the overflow spreads over the sessions with room left.
    expect(plan.sessions.map((session) => session.targetMinutes)).toEqual([44, 44, 38, 37, 37])
    expect(totalMinutes(plan)).toBe(200)
  })

  it('comes up short rather than lifting the ceiling for a week that cannot fit', () => {
    const plan = planCardioWeek(track({ weeklyMinutes: 300, longestSessionMinutes: 40 }), 1, 5)

    // 300 over five days is 60 each, but this athlete has never trained past 40
    // minutes. Five sessions of 44 is the most the week can honestly hold; the
    // missing 80 minutes are reported, not quietly poured into the sessions.
    expect(plan.sessions.map((session) => session.targetMinutes)).toEqual([44, 44, 44, 44, 44])
    expect(totalMinutes(plan)).toBe(220)
    expect(plan.shortfallMinutes).toBe(80)
  })

  it('never lets another session outrun the long one', () => {
    for (const [weekly, days] of [
      [150, 2],
      [90, 2],
      [120, 2],
      [175, 3],
      [204, 3],
      [300, 5],
    ]) {
      const sessions = planCardioWeek(track({ weeklyMinutes: weekly }), 1, days).sessions
      const long = sessions.find((session) => session.kind === 'long')!

      expect(Math.max(...sessions.map((session) => session.targetMinutes))).toBe(long.targetMinutes)
    }
  })

  it('merges easy sessions instead of emitting sub-20-minute ones', () => {
    const plan = planCardioWeek(track({ weeklyMinutes: 90 }), 1, 5)

    expect(plan.sessions.map((session) => session.targetMinutes)).toEqual([36, 27, 27])
    expect(plan.sessions.every((session) => session.targetMinutes >= 20)).toBe(true)
    expect(totalMinutes(plan)).toBe(90)
  })

  it('does not cram a whole week into the one day that is available', () => {
    const plan = planCardioWeek(track(), 1, 1)

    expect(plan.sessions).toHaveLength(1)
    expect(plan.sessions[0]).toMatchObject({ kind: 'long', targetMinutes: 66 })
    expect(plan.shortfallMinutes).toBe(84)
  })

  it('plans nothing when no day or no modality is available', () => {
    expect(planCardioWeek(track(), 1, 0).sessions).toEqual([])
    expect(planCardioWeek(track(), 1, 0).weeklyMinutes).toBe(0)
    expect(planCardioWeek(track({ modalities: [] }), 1, 3).sessions).toEqual([])
  })

  it('never lets a non-finite profile field reach a prescription', () => {
    // `targetMinutes: NaN` used to be stored and rendered as an empty number.
    for (const plan of [
      planCardioWeek(track({ weeklyMinutes: Number.NaN }), 1, 3),
      planCardioWeek(track({ longestSessionMinutes: Number.NaN }), 1, 3),
      planCardioWeek(track(), 1, Number.NaN),
    ]) {
      expect(Number.isFinite(plan.weeklyMinutes)).toBe(true)
      expect(Number.isFinite(plan.nextBaseline)).toBe(true)
      expect(plan.sessions.every((session) => Number.isFinite(session.targetMinutes))).toBe(true)
    }
  })
})

describe('session split — properties that must hold for every week', () => {
  // The split is where a plausible profile turns into something nobody would
  // actually train, so it is swept rather than sampled: 1..500 minutes over
  // 1..7 days for every plausible "longest session so far".
  it('holds across the whole input space', () => {
    const broken: string[] = []

    for (let weekly = 1; weekly <= 500; weekly += 1) {
      for (let days = 1; days <= 7; days += 1) {
        for (const longestSessionMinutes of [0, 15, 20, 30, 45, 60, 90, 120]) {
          const sessions = planCardioWeek(track({ weeklyMinutes: weekly, longestSessionMinutes }), 1, days).sessions
          const shape = `${weekly} min / ${days} days / longest ${longestSessionMinutes}: ${sessions
            .map((session) => `${session.kind} ${session.targetMinutes}`)
            .join(', ')}`
          const long = sessions.find((session) => session.kind === 'long')
          // A hard ceiling now: a week that cannot fit under it is reported
          // short instead of stretching a session past what has been trained.
          const ceiling = Math.floor(Math.max(20, longestSessionMinutes) * 1.1)
          const plan = planCardioWeek(track({ weeklyMinutes: weekly, longestSessionMinutes }), 1, days)

          if (sessions.length === 0 || sessions.length > days) broken.push(`session count — ${shape}`)
          if (totalMinutes({ sessions } as CardioWeekPlan) !== weekly - plan.shortfallMinutes) {
            broken.push(`total — ${shape}`)
          }
          if (plan.shortfallMinutes < 0) broken.push(`negative shortfall — ${shape}`)
          if (!long || sessions.some((session) => session.targetMinutes > long.targetMinutes)) {
            broken.push(`long is not the longest — ${shape}`)
          }
          if (sessions.some((session) => session.targetMinutes > ceiling)) broken.push(`over the ceiling — ${shape}`)
          if (sessions.some((session) => session.targetMinutes <= 0)) broken.push(`empty session — ${shape}`)
          if (weekly >= 2 * MIN_SESSION && sessions.some((session) => session.targetMinutes < MIN_SESSION)) {
            broken.push(`under ${MIN_SESSION} min — ${shape}`)
          }
        }
      }
    }

    expect(broken.slice(0, 5)).toEqual([])
  })
})

describe('modality rotation', () => {
  it('alternates two modalities and keeps the long session off swim', () => {
    let state = track({ modalities: ['run', 'swim'] })
    const picks: Modality[] = []

    for (let week = 0; week < 4; week += 1) {
      const plan = planCardioWeek(state, 1, 4)

      picks.push(...plan.sessions.map((session) => session.modality))
      expect(plan.sessions.find((session) => session.kind === 'long')!.modality).toBe('run')
      state = advance(state, plan)
    }

    for (let index = 1; index < picks.length; index += 1) {
      expect(picks[index]).not.toBe(picks[index - 1])
    }
  })

  it('lets swim take the long session when it is the only modality', () => {
    const plan = planCardioWeek(track({ modalities: ['swim'] }), 1, 2)

    expect(plan.sessions.every((session) => session.modality === 'swim')).toBe(true)
    expect(plan.sessions[0].kind).toBe('long')
    expect(totalMinutes(plan)).toBe(plan.weeklyMinutes)
  })

  it('keeps the long session off swim even when that repeats a modality over the weekend', () => {
    // Two modalities and three sessions a week: the cursor offers swim the long
    // slot, the veto skips it, and the week opens on the modality the last one
    // closed with. The four-day fixture above hides this behind its even count.
    let state = track({ modalities: ['run', 'swim'] })
    const weeks: Modality[][] = []

    for (let week = 0; week < 3; week += 1) {
      const plan = planCardioWeek(state, 1, 3)

      weeks.push(plan.sessions.map((session) => session.modality))
      state = advance(state, plan)
    }

    expect(weeks).toEqual([
      ['run', 'swim', 'run'],
      ['run', 'swim', 'run'],
      ['run', 'swim', 'run'],
    ])
    // Inside a week the rule still holds without exception.
    for (const week of weeks) {
      for (let index = 1; index < week.length; index += 1) expect(week[index]).not.toBe(week[index - 1])
    }
  })

  it('carries the rotation cursor so a fresh call continues the cycle', () => {
    const first = planCardioWeek(track(), 1, 2)
    const second = planCardioWeek({ ...track(), rotationCursor: first.rotationCursor }, 1, 2)

    expect(second.sessions[0].modality).not.toBe(first.sessions[first.sessions.length - 1].modality)
  })
})

describe('a week that does not fit the available days', () => {
  const cramped = track({ weeklyMinutes: 150, longestSessionMinutes: 60, modalities: ['run'] })

  it('comes up short rather than prescribing a session the athlete is untrained for', () => {
    const plan = planCardioWeek(cramped, 1, 1)

    expect(plan.sessions).toHaveLength(1)
    expect(plan.sessions[0].targetMinutes).toBe(66) // 60 x 1.1, not 150
    expect(plan.shortfallMinutes).toBe(84)
    expect(plan.weeklyMinutes).toBe(66)
  })

  it('reports no shortfall once there are enough days for the volume', () => {
    const plan = planCardioWeek(cramped, 1, 3)

    expect(plan.shortfallMinutes).toBe(0)
    expect(plan.weeklyMinutes).toBe(150)
    expect(plan.sessions.every((session) => session.targetMinutes <= 66)).toBe(true)
  })

  it('lifts the ceiling as longer sessions get logged', () => {
    const grown = { ...cramped, longestSessionMinutes: growLongestSession(60, 80) }

    expect(grown.longestSessionMinutes).toBe(80)
    expect(planCardioWeek(grown, 1, 2).shortfallMinutes).toBe(0)
    // and it never shrinks on an easy day
    expect(growLongestSession(80, 25)).toBe(80)
  })
})

/**
 * The read model behind TodayView.
 *
 * Every rule the screen needs already exists in `src/training/`; this module
 * only calls them in the right order and hands the view plain data, so that
 * `TodayView.vue` decides nothing. Pure: no Vue, no Firestore, no `Date` — the
 * caller passes `todayIso` in, which is what makes the whole screen replayable
 * for any day in a test.
 */

import { exerciseKey, prescribe } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import { format } from '@/liftoscript/weight'
import { applyComeback, type ComebackProposal } from '@/training/comeback'
import { claimToday, swapToday } from '@/training/composer'
import { evalContextFromSettings } from '@/training/plates'
import { planWeek, resolveToday, type TodayResolution, type WeekPlan } from '@/training/schedule'
import { currentStreak, weeklyRollup, type WeeklyRollup } from '@/training/stats'
import type { ExerciseState, PlannedItem, Profile, Session } from '@/types'
import { startOfWeekMonday } from '@/utils/date'

/** How many lifts of the day the headline names before it gets unreadable at arm's length. */
const HEADLINE_LIFTS = 2

export interface TodayModel {
  todayIso: string
  plan: WeekPlan
  resolution: TodayResolution
  item: PlannedItem | null
  catchUp: PlannedItem | null
  canClaim: boolean
  canSwap: boolean
  isDeloadWeek: boolean
  headline: string | null
  explanation: string | null
  activeSession: Session | null
  /**
   * Today's already-logged session, if the day is finished. `composeWeek` keeps
   * `planned` set on a day that already holds a done session, so `item` stays
   * non-null after training — without this flag the card would keep offering
   * "Start session" and a second document would advance the progression twice.
   */
  doneSession: Session | null
  streak: number
  rollup: WeeklyRollup
}

/**
 * What claiming or swapping today would produce. Both are pure composer calls:
 * nothing is persisted, and the sentence comes from the recomposed week rather
 * than from the view.
 */
export interface TodayOverride {
  item: PlannedItem | null
  explanation: string | null
}

/**
 * Today, fully resolved.
 *
 * `planWeek` is called here rather than reading `resolveToday` alone because
 * `TodayResolution` does not expose the `ComposeWeekInput`, and claim/swap need
 * exactly that input to recompose the week.
 */
export function buildToday(profile: Profile, sessions: Session[], todayIso: string): TodayModel {
  const plan = planWeek(profile, sessions, todayIso, todayIso)
  const resolution = resolveToday(profile, sessions, todayIso)

  const todaysSessions = sessions.filter((session) => session.date === todayIso)
  const doneSession = todaysSessions.find((session) => session.status === 'done') ?? null
  const hasDoneSession = doneSession !== null

  return {
    todayIso,
    plan,
    resolution,
    item: resolution.item,
    catchUp: resolution.catchUp,
    // Offering a bonus session to someone who is on track is how overtraining
    // starts: `catchUp` is already null when the week's budget is covered.
    canClaim: resolution.isRestDay && resolution.catchUp !== null,
    // A logged session is history — there is nothing left to swap.
    canSwap: resolution.item !== null && !hasDoneSession,
    isDeloadWeek: resolution.isDeloadWeek,
    headline: resolution.item?.kind === 'strength' ? strengthHeadline(profile, resolution.item.programDay) : null,
    explanation: plan.week.explanations[0] ?? null,
    activeSession: todaysSessions.find((session) => session.status === 'active') ?? null,
    doneSession,
    streak: currentStreak(profile, sessions, todayIso),
    rollup: weeklyRollup(profile, sessions, startOfWeekMonday(todayIso), plan.week),
  }
}

function plannedOn(days: { date: string; planned: PlannedItem | null }[], dateIso: string): PlannedItem | null {
  return days.find((day) => day.date === dateIso)?.planned ?? null
}

/** Claiming today: the most valuable outstanding session, plus the composer's own sentence. */
export function claimedOutcome(model: TodayModel): TodayOverride {
  const week = claimToday(model.plan.week, model.todayIso, model.plan.input)

  return { item: plannedOn(week.days, model.todayIso), explanation: week.explanations[0] ?? null }
}

/** Swapping today: the other track's next item. Nothing is dropped — the rotation is a cursor. */
export function swappedOutcome(model: TodayModel): TodayOverride {
  const week = swapToday(model.plan.week, model.todayIso, model.plan.input)

  return { item: plannedOn(week.days, model.todayIso), explanation: week.explanations[0] ?? null }
}

export function claimedItem(model: TodayModel): PlannedItem | null {
  return claimedOutcome(model).item
}

export function swappedItem(model: TodayModel): PlannedItem | null {
  return swappedOutcome(model).item
}

/**
 * What the day will ask of the athlete, e.g. `'Squat 100 kg - Bench Press 70 kg'`.
 *
 * Only the first two lines: the point is "is this the heavy day and how heavy",
 * read at a glance on the home screen, not a full session preview.
 *
 * `null` when the program text does not parse or has no such day — the card
 * then simply shows the program day, and the session screen is the place that
 * refuses to start on a broken program.
 */
export function strengthHeadline(profile: Profile, programDay: string): string | null {
  const { program, diagnostics } = parseProgram(profile.strengthTrack.programText)
  if (diagnostics.length > 0) return null

  let week = 0
  let day = 0

  for (const [weekIndex, programWeek] of program.weeks.entries()) {
    const dayIndex = programWeek.days.findIndex((entry) => entry.name === programDay)
    if (dayIndex >= 0) {
      week = weekIndex + 1
      day = dayIndex + 1
      break
    }
  }

  if (week === 0) return null

  // The slot matters: the same lift can sit on several days, and `prescribe`
  // resolves the line at `ctx.week`/`ctx.day` first.
  const ctx = evalContextFromSettings(profile.settings, { week, day })
  const lines = program.weeks[week - 1].days[day - 1].exercises.slice(0, HEADLINE_LIFTS)
  if (lines.length === 0) return null

  const parts = lines.map((line) => {
    const key = exerciseKey(line)
    const state: ExerciseState = profile.strengthTrack.programState[key] ?? {
      weights: [],
      setVariationIndex: 1,
      state: {},
      askWeight: true,
    }
    const { sets } = prescribe(program, key, state, ctx)
    const weight = sets[0]?.weight

    // DECISION: a lift whose weight is not known yet (`askWeight`, or a program
    // that resolved nothing) is named without a number rather than shown as
    // "0 kg" — the session screen is where the athlete is asked for it.
    return weight && weight.value > 0 ? `${line.name} ${format(weight)}` : line.name
  })

  return parts.join(' - ')
}

/**
 * The full profile slices an accepted comeback writes.
 *
 * `updateDoc` replaces a nested object wholesale, so `strengthTrack` is spread
 * complete — a patch carrying only `programState` would wipe `programText` and
 * `rotationCursor`. `cardioTrack` comes back complete from `applyComeback`,
 * including `lastPlannedMinutes` and `holdStreak`, without which the next week
 * reads as a miss and steps the baseline back on top of the comeback.
 */
export function comebackPatch(profile: Profile, proposal: ComebackProposal): Partial<Profile> {
  const { programState, cardioTrack } = applyComeback(profile, proposal)

  return { strengthTrack: { ...profile.strengthTrack, programState }, cardioTrack }
}

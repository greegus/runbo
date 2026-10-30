/**
 * Calendar composer: merges the two orthogonal tracks (strength rotation and
 * prescribed cardio) into one week.
 *
 * Everything here is a pure function of its input — no `Date`, no randomness —
 * so the same profile always produces the same week and a whole training block
 * can be replayed in a test.
 *
 * Two ideas carry the whole module:
 *
 * 1. **The strength rotation is cursor-driven.** Free strength days are handed
 *    `programDays[cursor]`, `programDays[cursor + 1]`, … in calendar order. The
 *    cursor only advances when a session is actually logged, so a missed or
 *    swapped-away workout is never skipped — it simply happens on the next
 *    strength day and everything after it shifts by one.
 * 2. **Interference is encoded as predicates, not as special cases.** Hard
 *    cardio and long sessions ask the predicates below whether a day is legal;
 *    when no day is, the session is demoted (easy, same duration) rather than
 *    dropped, because keeping the volume matters more than keeping the flavour.
 */

import type { CardioPrescription, ComposedWeek, PlannedItem, Profile, Session } from '@/types'
import { addDays, WEEK_LENGTH, WEEKDAY_LABELS, weekdayIndexMondayFirst } from '@/utils/date'

/** GZCLP is written as a three-day-a-week program, so that is where an athlete who never says otherwise starts. */
export const DEFAULT_STRENGTH_DAYS_PER_WEEK = 3

export type Track = 'strength' | 'cardio'

export interface ComposeWeekInput {
  /** ISO Monday of the week being composed. */
  weekStart: string
  availability: Profile['availability']
  /** `strengthTrack.rotationCursor` — index into `programDays`. */
  rotationCursor: number
  /**
   * The program's day names in rotation order, e.g. `['A1', 'B1', 'A2', 'B2']`.
   * NOTE: not in the plan's input list, but `rotationCursor` is only an index —
   * without the names no `PlannedItem` can be built.
   */
  programDays: string[]
  /** This week's prescriptions from `planCardioWeek`, already sized for the week. */
  cardioSessions: CardioPrescription[]
  heavyLowerDays: (programDay: string) => boolean
  /** This week's already-logged sessions — these days are fixed. */
  completedSessions: Session[]
  /**
   * Optional "compose from here on" marker. Days before it that hold no logged
   * session cannot happen any more, so they are freed and their work rolls
   * forward. Omit it to plan the whole week (onboarding preview, PlanView of a
   * future week).
   */
  fromDate?: string
}

/**
 * `ComposedWeek` plus the reasoning. The extra field is additive, so the result
 * is still a `ComposedWeek` everywhere one is expected.
 */
export interface ComposedWeekPlan extends ComposedWeek {
  explanations: string[]
}

/** A strength day that is already placed — what the interference predicates reason over. */
export interface StrengthSlot {
  date: string
  programDay: string
}

// ---------------------------------------------------------------------------
// Interference predicates
// ---------------------------------------------------------------------------

/** Intervals and tempo are the sessions that compete with heavy lifting for recovery. */
export function isHardCardio(prescription: CardioPrescription): boolean {
  return prescription.kind === 'intervals' || prescription.kind === 'tempo'
}

/**
 * MVP runs one session per day, so "no hard cardio on a strength day" is
 * structural: the day is simply taken.
 */
export function sharesDayWithStrength(dateIso: string, strengthSlots: StrengthSlot[]): boolean {
  return strengthSlots.some((slot) => slot.date === dateIso)
}

/** True when the day immediately after `dateIso` is a squat/deadlift day. */
export function isDayBeforeHeavyLower(
  dateIso: string,
  strengthSlots: StrengthSlot[],
  heavyLowerDays: (programDay: string) => boolean,
): boolean {
  const tomorrow = addDays(dateIso, 1)

  return strengthSlots.some((slot) => slot.date === tomorrow && heavyLowerDays(slot.programDay))
}

/**
 * Intervals/tempo may not share a day with strength, may not sit the day before
 * a heavy lower session, and may not sit the day before the long session.
 */
export function canPlaceHardCardio(
  dateIso: string,
  strengthSlots: StrengthSlot[],
  heavyLowerDays: (programDay: string) => boolean,
  longSessionDate?: string | null,
): boolean {
  if (sharesDayWithStrength(dateIso, strengthSlots)) return false
  if (isDayBeforeHeavyLower(dateIso, strengthSlots, heavyLowerDays)) return false

  return !(longSessionDate && addDays(dateIso, 1) === longSessionDate)
}

/** The long session only has the heavy-lower rule; it may sit before the intervals day. */
export function canPlaceLongSession(
  dateIso: string,
  strengthSlots: StrengthSlot[],
  heavyLowerDays: (programDay: string) => boolean,
): boolean {
  if (sharesDayWithStrength(dateIso, strengthSlots)) return false

  return !isDayBeforeHeavyLower(dateIso, strengthSlots, heavyLowerDays)
}

/** Same modality, same minutes, no structure — the volume survives, the intensity does not. */
export function demoteToEasy(prescription: CardioPrescription): CardioPrescription {
  return { modality: prescription.modality, kind: 'easy', targetMinutes: prescription.targetMinutes, zone: 2 }
}

// ---------------------------------------------------------------------------
// Day budget
// ---------------------------------------------------------------------------

/**
 * The weekdays (0 = Mon) that carry training. Preferred days first; when the
 * profile lists fewer of them than the budget, fill forward from Monday.
 */
export function trainingWeekdays(availability: Profile['availability']): number[] {
  const budget = weeklyBudget(availability)
  const preferred: number[] = []

  for (const day of availability.preferredDays ?? []) {
    if (Number.isInteger(day) && day >= 0 && day < WEEK_LENGTH && !preferred.includes(day)) preferred.push(day)
  }
  preferred.sort((a, b) => a - b)

  const days = preferred.slice(0, budget)
  for (let day = 0; day < WEEK_LENGTH && days.length < budget; day += 1) {
    if (!days.includes(day)) days.push(day)
  }

  return days.sort((a, b) => a - b)
}

function weeklyBudget(availability: Profile['availability']): number {
  return Math.max(0, Math.min(WEEK_LENGTH, Math.trunc(availability.daysPerWeek || 0)))
}

export interface TrackBudget {
  trainingDays: number
  strengthDays: number
  cardioDays: number
}

/**
 * How many of the week's training days the athlete asked to spend lifting. A
 * profile that predates the setting answers with the old hard-coded cap, so its
 * weeks keep composing exactly as before.
 */
export function strengthDaysPerWeek(availability: Profile['availability']): number {
  const asked = availability.strengthDaysPerWeek

  return typeof asked === 'number' && Number.isFinite(asked)
    ? Math.max(0, Math.min(WEEK_LENGTH, Math.trunc(asked)))
    : DEFAULT_STRENGTH_DAYS_PER_WEEK
}

/**
 * How the week's training days split between the tracks. Strength takes as many
 * days as the athlete asked for — never more than the week has — and cardio
 * keeps at least one day whenever there is cardio to do, because a week of pure
 * lifting is not what either track is for.
 */
export function weeklyTrackBudget(availability: Profile['availability'], cardioSessionCount: number): TrackBudget {
  const trainingDays = weeklyBudget(availability)

  let strengthDays = Math.min(strengthDaysPerWeek(availability), trainingDays)
  let cardioDays = trainingDays - strengthDays

  if (cardioSessionCount > 0 && cardioDays === 0 && trainingDays > 1) {
    cardioDays = 1
    strengthDays = trainingDays - 1
  }

  return { trainingDays, strengthDays, cardioDays: Math.min(cardioDays, cardioSessionCount) }
}

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

function combinations(items: number[], count: number): number[][] {
  if (count <= 0) return [[]]
  if (count > items.length) return []

  const result: number[][] = []
  const walk = (start: number, acc: number[]) => {
    if (acc.length === count) {
      result.push([...acc])
      return
    }
    for (let index = start; index < items.length; index += 1) {
      acc.push(items[index])
      walk(index + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])

  return result
}

/**
 * Gaps between the chosen weekdays, counting the wrap-around into next Monday.
 * The week repeats, so Sunday+Monday is a back-to-back pair even though the
 * plain difference says six days.
 */
export function cyclicGaps(weekdays: number[]): number[] {
  if (weekdays.length === 0) return []

  const sorted = [...weekdays].sort((a, b) => a - b)
  if (sorted.length === 1) return [WEEK_LENGTH]

  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) gaps.push(sorted[index] - sorted[index - 1])
  gaps.push(sorted[0] + WEEK_LENGTH - sorted[sorted.length - 1])

  return gaps
}

/**
 * The gaps of a layout, tightest first — the vector two candidate layouts are
 * ranked on. Positive when `a` is the better spread.
 *
 * Ranking on the tightest gap ALONE is not enough: out of Mon–Thu, Mon/Tue/Wed
 * and Mon/Tue/Thu both have a tightest gap of one day, so the tie-break used to
 * fall through to "earliest days" and hand back three lifting days in a row.
 * Comparing the next-tightest gap after that separates them (1,1,5 vs 1,2,4)
 * and picks the layout with only one back-to-back pair.
 */
function compareSpread(a: number[], b: number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }

  return 0
}

/**
 * Picks `count` of `candidates` so that the gaps between training days
 * (`pinned` days included) are as wide as possible — the Mon/Wed/Fri instinct,
 * expressed as a number. Ties prefer leaving the long-session day free, then the
 * earliest days, so the choice is fully deterministic.
 */
export function chooseSpreadDays(candidates: number[], count: number, pinned: number[], avoid: number): number[] {
  const wanted = Math.max(0, Math.min(count, candidates.length))
  let best: number[] = []
  let bestSpread: number[] | null = null
  let bestAvoidHits = Number.POSITIVE_INFINITY
  let bestKey = ''

  for (const combo of combinations(candidates, wanted)) {
    const gaps = cyclicGaps([...pinned, ...combo])
    const spread = gaps.length === 0 ? [WEEK_LENGTH] : gaps.sort((left, right) => left - right)
    const avoidHits = combo.filter((day) => day === avoid).length
    const key = combo.join(',')
    const bySpread = bestSpread === null ? 1 : compareSpread(spread, bestSpread)

    const better =
      bySpread > 0 ||
      (bySpread === 0 && avoidHits < bestAvoidHits) ||
      (bySpread === 0 && avoidHits === bestAvoidHits && (bestKey === '' ? false : key < bestKey))

    if (bestSpread === null || better) {
      best = combo
      bestSpread = spread
      bestAvoidHits = avoidHits
      bestKey = key
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function weekDates(weekStart: string): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, offset) => addDays(weekStart, offset))
}

function label(dateIso: string): string {
  return `${WEEKDAY_LABELS[weekdayIndexMondayFirst(dateIso)]} ${dateIso}`
}

function describe(prescription: CardioPrescription): string {
  const structure = prescription.structure ? ` (${structure_(prescription)})` : ''

  return `${prescription.kind} ${prescription.modality} ${prescription.targetMinutes} min${structure} @Z${prescription.zone}`
}

function structure_(prescription: CardioPrescription): string {
  const s = prescription.structure

  return s ? `${s.reps}x${s.workMinutes}min / ${s.restMinutes}min` : ''
}

/**
 * The days this week that already hold a logged session. A Strava import can
 * arrive without a prescription — the day is still taken, so it gets a
 * stand-in easy session rather than being handed back to the composer.
 */
function fixedItems(input: ComposeWeekInput, dates: string[]): Map<string, PlannedItem> {
  const byDate = new Map<string, PlannedItem>()

  for (const session of input.completedSessions) {
    if (!dates.includes(session.date) || byDate.has(session.date)) continue

    if (session.kind === 'strength') {
      byDate.set(session.date, {
        kind: 'strength',
        programDay: session.programDay ?? input.programDays[0] ?? 'Workout',
      })
    } else {
      byDate.set(session.date, {
        kind: 'cardio',
        prescription: session.prescription ?? {
          modality: 'run',
          kind: 'easy',
          targetMinutes: session.minutes ?? 0,
          zone: 2,
        },
      })
    }
  }

  return byDate
}

/** Which track each training day belongs to, before any item is assigned. */
function planTracks(input: ComposeWeekInput, dates: string[], fixed: Map<string, PlannedItem>): Map<string, Track> {
  const tracks = new Map<string, Track>()

  // A logged session owns its day whatever the availability says — it happened.
  for (const [date, item] of fixed) tracks.set(date, item.kind)

  const budget = weeklyTrackBudget(input.availability, input.cardioSessions.length)
  const training = trainingWeekdays(input.availability)

  const fixedItemsList = [...fixed.values()]
  const fixedStrength = fixedItemsList.filter((item) => item.kind === 'strength').length
  const fixedCardio = fixedItemsList.filter((item) => item.kind === 'cardio').length

  const pinnedStrengthWeekdays = [...fixed.entries()]
    .filter(([, item]) => item.kind === 'strength')
    .map(([date]) => weekdayIndexMondayFirst(date))

  // A weekday index is not an offset into the window: `dates[weekday]` is only
  // the athlete's Monday-first weekday while `weekStart` happens to be a Monday.
  // Go through the dates themselves so the layout follows the athlete's real
  // weekdays whatever day the window opens on.
  const dateOfWeekday = new Map(dates.map((date) => [weekdayIndexMondayFirst(date), date]))

  const freeWeekdays = training.filter((weekday) => {
    const date = dateOfWeekday.get(weekday)
    return date !== undefined && !tracks.has(date)
  })
  const needStrength = Math.max(0, budget.strengthDays - fixedStrength)
  const needCardio = Math.max(0, budget.cardioDays - fixedCardio)

  // Only worth steering strength away from the long-session day when there is a
  // long session that wants it.
  const avoid = input.cardioSessions.some((session) => session.kind === 'long') ? input.availability.longSessionDay : -1

  const strengthWeekdays = chooseSpreadDays(freeWeekdays, needStrength, pinnedStrengthWeekdays, avoid)
  for (const weekday of strengthWeekdays) {
    const date = dateOfWeekday.get(weekday)
    if (date) tracks.set(date, 'strength')
  }

  const rest = freeWeekdays.filter((weekday) => !strengthWeekdays.includes(weekday))
  // The long-session day goes first so a short cardio budget never spends its
  // days elsewhere and leaves the long session homeless.
  const ordered = [...rest].sort(
    (a, b) =>
      rankForCardio(a, dateOfWeekday, dates, input.availability.longSessionDay) -
      rankForCardio(b, dateOfWeekday, dates, input.availability.longSessionDay),
  )
  for (const weekday of ordered.slice(0, needCardio)) {
    const date = dateOfWeekday.get(weekday)
    if (date) tracks.set(date, 'cardio')
  }

  return tracks
}

/**
 * The long-session day first, then the rest in the order the window visits
 * them. Ranking on the raw weekday index would order Sunday last even in a
 * window that opens on Sunday; the position in `dates` is the same number under
 * a Monday anchor and the honest one under any other.
 */
function rankForCardio(
  weekday: number,
  dateOfWeekday: Map<number, string>,
  dates: string[],
  longSessionDay: number,
): number {
  return weekday === longSessionDay ? -1 : dates.indexOf(dateOfWeekday.get(weekday) ?? '')
}

/** Days before `fromDate` without a logged session cannot happen any more. */
function applyFrontier(tracks: Map<string, Track>, fixed: Map<string, PlannedItem>, fromDate?: string): void {
  if (!fromDate) return

  // Deleting from a Map during iteration is well defined — the iterator just
  // skips the removed entries.
  for (const date of tracks.keys()) {
    if (date < fromDate && !fixed.has(date)) tracks.delete(date)
  }
}

function closestTo(dates: string[], longSessionDay: number): string {
  return dates.reduce((best, date) => {
    const bestDistance = Math.abs(weekdayIndexMondayFirst(best) - longSessionDay)
    const distance = Math.abs(weekdayIndexMondayFirst(date) - longSessionDay)

    // Later day wins a tie: a long session belongs at the end of the week.
    return distance < bestDistance || (distance === bestDistance && date > best) ? date : best
  })
}

/** Removes one prescription matching `used` from `pool`, tolerating a demotion. */
function consume(pool: CardioPrescription[], used: CardioPrescription): void {
  const exact = pool.findIndex(
    (item) => item.modality === used.modality && item.kind === used.kind && item.targetMinutes === used.targetMinutes,
  )
  const index =
    exact >= 0
      ? exact
      : pool.findIndex((item) => item.modality === used.modality && item.targetMinutes === used.targetMinutes)

  if (index >= 0) pool.splice(index, 1)
}

/** A cardio prescription the athlete placed on a day themselves — see `replaceToday`. */
interface PinnedCardio {
  date: string
  prescription: CardioPrescription
}

/**
 * The week is not the end of training. A Sunday interval session still lands
 * the evening before next Monday's lift, and the interference predicates only
 * see the slots they are given — so next week's first strength day joins them
 * as a virtual slot. The pattern repeats, so it sits seven days after this
 * week's first strength day and carries the program day the cursor will be on
 * once this week is logged (`step` is how many of the slots the cursor fed). It
 * can only ever bite on the last day of the week.
 */
function nextWeekSlot(slots: StrengthSlot[], input: ComposeWeekInput, step: number): StrengthSlot[] {
  const first = slots[0]
  if (!first || input.programDays.length === 0) return []

  return [
    {
      date: addDays(first.date, WEEK_LENGTH),
      programDay: input.programDays[(input.rotationCursor + step) % input.programDays.length],
    },
  ]
}

/**
 * Fills a decided track layout with actual items: program days from the
 * rotation cursor, prescriptions through the interference predicates.
 */
function assignItems(
  input: ComposeWeekInput,
  dates: string[],
  tracks: Map<string, Track>,
  fixed: Map<string, PlannedItem>,
  preferCardioDate?: string,
  pinned?: PinnedCardio,
): ComposedWeekPlan {
  const explanations: string[] = []
  const planned = new Map<string, PlannedItem>()
  // No day list means no program to run — a profile whose text does not parse,
  // or one that has no strength at all. Inventing a "Workout" day here used to
  // hide that: the week looked normal until the session screen refused to start,
  // which is the worst place to find out. An empty rotation now simply schedules
  // no strength, and the cardio budget takes the days.
  const programDays = input.programDays

  // --- strength -------------------------------------------------------------
  const slots: StrengthSlot[] = []
  let step = 0

  for (const date of dates) {
    if (tracks.get(date) !== 'strength') continue

    const existing = fixed.get(date)
    if (existing && existing.kind === 'strength') {
      planned.set(date, existing)
      slots.push({ date, programDay: existing.programDay })
      explanations.push(`${label(date)}: ${existing.programDay} — already logged, left where it is.`)
      continue
    }

    // Nothing to rotate through: leave the day unplanned rather than divide by
    // zero. A session already logged above still stands — it happened.
    if (programDays.length === 0) continue

    const position = (input.rotationCursor + step) % programDays.length
    const programDay = programDays[position]
    step += 1
    planned.set(date, { kind: 'strength', programDay })
    slots.push({ date, programDay })
    explanations.push(
      `${label(date)}: strength ${programDay} — rotation position ${position + 1}/${programDays.length}.`,
    )
  }

  slots.push(...nextWeekSlot(slots, input, step))

  // --- cardio ---------------------------------------------------------------
  const pool = [...input.cardioSessions]
  const available: string[] = []

  for (const date of dates) {
    if (tracks.get(date) !== 'cardio') continue

    const existing = fixed.get(date)
    if (existing && existing.kind === 'cardio') {
      planned.set(date, existing)
      consume(pool, existing.prescription)
      explanations.push(`${label(date)}: ${describe(existing.prescription)} — already logged, left where it is.`)
      continue
    }

    // The athlete's own pick holds its day the way a logged session does, and
    // takes its prescription out of the pool so no other day gets it too.
    if (pinned && pinned.date === date) {
      planned.set(date, { kind: 'cardio', prescription: pinned.prescription })
      consume(pool, pinned.prescription)
      explanations.push(`${label(date)}: ${describe(pinned.prescription)} — chosen for this day.`)
      continue
    }

    available.push(date)
  }

  // Guarded: `splice(-1, 1)` would quietly drop the LAST free day instead of
  // the one that was just used.
  const take = (date: string) => {
    const index = available.indexOf(date)
    if (index >= 0) available.splice(index, 1)
  }

  // Long session: the preferred day first, then the nearest legal day, and only
  // then a demotion — the week keeps the minutes even when it loses the flavour.
  // A pinned long session is still the long session: the hard one keeps off the day before it.
  let longSessionDate: string | null = pinned?.prescription.kind === 'long' ? pinned.date : null
  const longIndex = pool.findIndex((prescription) => prescription.kind === 'long')

  if (longIndex >= 0 && available.length > 0) {
    const [long] = pool.splice(longIndex, 1)
    const preferred = available.find((date) => weekdayIndexMondayFirst(date) === input.availability.longSessionDay)
    // A pinned hard session already sits where it sits, so the long one keeps
    // off the day after it — the same pair `canPlaceHardCardio` rules out.
    const fits = (date: string) =>
      canPlaceLongSession(date, slots, input.heavyLowerDays) &&
      !(pinned && isHardCardio(pinned.prescription) && date === addDays(pinned.date, 1))
    const legal = available.filter(fits)

    let target: string
    let prescription = long

    if (preferred && fits(preferred)) {
      target = preferred
      explanations.push(`${label(target)}: ${describe(long)} — the preferred long-session day.`)
    } else if (legal.length > 0) {
      target = closestTo(legal, input.availability.longSessionDay)
      explanations.push(
        `${label(target)}: ${describe(long)} — nearest cardio day to the preferred one that is not the day before a heavy lower session.`,
      )
    } else {
      target = preferred ?? available[available.length - 1]
      prescription = demoteToEasy(long)
      explanations.push(
        `${label(target)}: long session demoted to ${describe(prescription)} — every free cardio day sits the day before a heavy lower session, so the duration is kept and the load is not.`,
      )
    }

    planned.set(target, { kind: 'cardio', prescription })
    longSessionDate = target
    take(target)
  }

  // Hard session: the earliest day that clears every interference rule.
  const hardIndex = pool.findIndex(isHardCardio)

  if (hardIndex >= 0 && available.length > 0) {
    const [hard] = pool.splice(hardIndex, 1)
    const legal = available.filter((date) => canPlaceHardCardio(date, slots, input.heavyLowerDays, longSessionDate))
    const target = legal[0] ?? available[0]
    const prescription = legal.length > 0 ? hard : demoteToEasy(hard)

    explanations.push(
      legal.length > 0
        ? `${label(target)}: ${describe(hard)} — clear of the heavy lower days and of the long session.`
        : `${label(target)}: ${hard.kind} demoted to ${describe(prescription)} — no cardio day clears the day before a heavy lower session.`,
    )

    planned.set(target, { kind: 'cardio', prescription })
    take(target)
  }

  // Everything else fills the remaining days in order; a swapped-in day gets
  // first pick so an explicit override never lands on an empty day.
  const fillOrder =
    preferCardioDate && available.includes(preferCardioDate)
      ? [preferCardioDate, ...available.filter((date) => date !== preferCardioDate)]
      : [...available]

  for (const date of fillOrder) {
    const prescription = pool.shift()
    if (!prescription) break

    planned.set(date, { kind: 'cardio', prescription })
    explanations.push(`${label(date)}: ${describe(prescription)} — fills a remaining cardio day.`)
  }

  if (pool.length > 0) {
    explanations.push(
      `${pool.length} cardio session(s) had no day left this week and roll forward — nothing is dropped.`,
    )
  }

  return {
    weekStart: input.weekStart,
    days: dates.map((date) => ({ date, planned: planned.get(date) ?? null })),
    explanations,
  }
}

/** Composes one week from the two tracks. */
export function composeWeek(input: ComposeWeekInput): ComposedWeekPlan {
  const dates = weekDates(input.weekStart)
  const fixed = fixedItems(input, dates)
  const tracks = planTracks(input, dates, fixed)
  applyFrontier(tracks, fixed, input.fromDate)

  return assignItems(input, dates, tracks, fixed)
}

/** One human line per placement decision, for PlanView and for tests. */
export function explainPlacement(week: ComposedWeek): string[] {
  const stored = (week as Partial<ComposedWeekPlan>).explanations
  if (stored) return stored

  const lines: string[] = []
  for (const day of week.days) {
    const item = day.planned
    if (!item) continue
    lines.push(
      item.kind === 'strength'
        ? `${label(day.date)}: strength ${item.programDay}.`
        : `${label(day.date)}: ${describe(item.prescription)}.`,
    )
  }

  return lines
}

function toPlan(week: ComposedWeek): ComposedWeekPlan {
  return { weekStart: week.weekStart, days: week.days.map((day) => ({ ...day })), explanations: explainPlacement(week) }
}

function tracksFromWeek(week: ComposedWeek): Map<string, Track> {
  const tracks = new Map<string, Track>()
  for (const day of week.days) {
    if (day.planned) tracks.set(day.date, day.planned.kind)
  }

  return tracks
}

/**
 * Replaces the day's item with the other track's next item and recomposes the
 * remainder of the week. Nothing is skipped: the displaced strength workout
 * lands on the next strength day because the rotation is cursor-driven.
 */
export function swapToday(week: ComposedWeek, dateIso: string, input: ComposeWeekInput): ComposedWeekPlan {
  const dates = weekDates(input.weekStart)
  const day = week.days.find((entry) => entry.date === dateIso)
  if (!day || !day.planned) return toPlan(week)

  const fixed = fixedItems(input, dates)
  // A logged session is history — there is nothing left to swap.
  if (fixed.has(dateIso)) return toPlan(week)

  const tracks = tracksFromWeek(week)
  const swapped: Track = day.planned.kind === 'strength' ? 'cardio' : 'strength'
  tracks.set(dateIso, swapped)

  const plan = assignItems(input, dates, tracks, fixed, swapped === 'cardio' ? dateIso : undefined)
  plan.explanations.unshift(
    `${label(dateIso)} swapped to ${swapped} — the displaced work moves to the next training day, nothing is dropped.`,
  )

  return plan
}

/** One workout a day can be replaced with, and where the week holds it now. */
export interface ReplacementOption {
  item: PlannedItem
  /**
   * The later day this week that holds the workout — it moves to today and
   * that day takes over today's track — or `null` for work the week still owes
   * and no day holds: a cardio session from a missed day that the remaining
   * cardio days could not absorb, or the rotation's next strength day while the
   * week is short of one. A `null` pick adds to the week rather than moving.
   */
  from: string | null
}

function countKind(week: ComposedWeek, kind: Track): number {
  return week.days.filter((entry) => entry.planned?.kind === kind).length
}

function itemKey(item: PlannedItem): string {
  return item.kind === 'strength' ? `strength:${item.programDay}` : `cardio:${JSON.stringify(item.prescription)}`
}

function describeItem(item: PlannedItem): string {
  return item.kind === 'strength' ? `strength ${item.programDay}` : describe(item.prescription)
}

/**
 * What the athlete may train on `dateIso` instead of what is planned there.
 *
 * Strength is offered only as the day the rotation is on: the first strength
 * day later in the week already holds it, because the cursor fills strength
 * days in calendar order. Offering Friday's A2 on a Monday that owes A1 would
 * let one tap skip two program days, and the cursor — which follows the program
 * day actually logged — would never come back for them. That one workout can
 * stand twice on a rest day the week is behind on: added as owed work, or
 * moved from the later day that holds it.
 *
 * Cardio is offered per prescription: every session still planned later in the
 * week, plus the ones no day holds any more. Identical prescriptions collapse
 * into one option, and today's own item is never offered back.
 */
export function replacementOptions(week: ComposedWeek, dateIso: string, input: ComposeWeekInput): ReplacementOption[] {
  const dates = weekDates(input.weekStart)
  const day = week.days.find((entry) => entry.date === dateIso)
  if (!day) return []

  const fixed = fixedItems(input, dates)
  // A logged session is history — there is nothing left to replace.
  if (fixed.has(dateIso)) return []

  const later = week.days.filter((entry) => entry.date > dateIso && entry.planned !== null && !fixed.has(entry.date))
  const options: ReplacementOption[] = []

  const budget = weeklyTrackBudget(input.availability, input.cardioSessions.length)

  if (day.planned?.kind !== 'strength' && input.programDays.length > 0) {
    const due = later.find((entry) => entry.planned?.kind === 'strength')
    // The week still owes a strength day: one was missed earlier, or none is
    // left to hold it. `replaceToday` releases every earlier unlogged day, so
    // this day becomes the first free strength day and the cursor hands it
    // exactly the day it points at. A rest day is offered it even when a later
    // day holds the same workout: taking the owed day ADDS a training day and
    // catches the week up, where moving the later one only reorders it. When
    // the week's lifting is covered nothing is added: that would be a bonus
    // session, not outstanding work.
    if (countKind(week, 'strength') < budget.strengthDays && (day.planned === null || !due)) {
      const programDay = input.programDays[input.rotationCursor % input.programDays.length]
      options.push({ item: { kind: 'strength', programDay }, from: null })
    }
    if (due?.planned) options.push({ item: due.planned, from: due.date })
  }

  for (const entry of later) {
    if (entry.planned?.kind === 'cardio') options.push({ item: entry.planned, from: entry.date })
  }

  // What the week no longer places anywhere: the pool, minus every prescription
  // some day holds — planned or logged. Only while fewer days hold cardio than
  // the pool has sessions, though: a Strava run logged without a prescription
  // stands in for one it does not match exactly, and offering that one again as
  // "missed" would have the athlete do the same session twice.
  if (countKind(week, 'cardio') < input.cardioSessions.length) {
    const pool = [...input.cardioSessions]
    for (const entry of week.days) {
      if (entry.planned?.kind === 'cardio') consume(pool, entry.planned.prescription)
    }
    for (const prescription of pool) options.push({ item: { kind: 'cardio', prescription }, from: null })
  }

  const today = day.planned ? itemKey(day.planned) : null
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = itemKey(option.item)
    if (key === today) return false
    // The same workout may stand twice — owed by the week and held by a later
    // day — and the two do different things to the week, so both stay.
    const slot = `${option.from === null ? 'owed' : 'later'}:${key}`
    if (seen.has(slot)) return false
    seen.add(slot)
    return true
  })
}

/**
 * Trains `option` on `dateIso` instead of what the day holds, and recomposes
 * the rest of the week around it.
 *
 * When the workout came from a later day, the two days trade TRACKS: that day
 * takes over whatever today was (or becomes a rest day if today was one), so the
 * week keeps its shape and the moved workout cannot stay where it was as well. A
 * strength pick takes the rotation's next day; a cardio pick is pinned as it is
 * and leaves the pool, and the remaining prescriptions are placed by the usual
 * rules. What today used to hold is displaced, never dropped: strength shifts
 * along the cursor, cardio goes back to the pool and fills a later cardio day or
 * rolls forward.
 *
 * The pick is the athlete's, so the interference rules do not veto it: a hard or
 * long session the day before a heavy lower day is placed anyway, and the
 * explanation says so.
 */
export function replaceToday(
  week: ComposedWeek,
  dateIso: string,
  input: ComposeWeekInput,
  option: ReplacementOption,
): ComposedWeekPlan {
  const dates = weekDates(input.weekStart)
  const day = week.days.find((entry) => entry.date === dateIso)
  if (!day) return toPlan(week)

  const fixed = fixedItems(input, dates)
  // A logged session is history — on this day and on the day a workout would be moved from.
  if (fixed.has(dateIso) || (option.from !== null && fixed.has(option.from))) return toPlan(week)

  const tracks = tracksFromWeek(week)
  // Earlier days that never happened are released, so their work is what this
  // day can pick up.
  for (const date of tracks.keys()) {
    if (date < dateIso && !fixed.has(date)) tracks.delete(date)
  }

  const original = day.planned
  tracks.set(dateIso, option.item.kind)
  if (option.from !== null && option.from !== dateIso) {
    if (original) tracks.set(option.from, original.kind)
    else tracks.delete(option.from)
  }

  const pinned = option.item.kind === 'cardio' ? { date: dateIso, prescription: option.item.prescription } : undefined
  const plan = assignItems(input, dates, tracks, fixed, undefined, pinned)

  const placed = plan.days.find((entry) => entry.date === dateIso)?.planned ?? option.item
  const origin =
    option.from !== null
      ? `from ${label(option.from)}`
      : option.item.kind === 'cardio'
        ? 'missed earlier this week'
        : 'owed this week'
  const consequence = original
    ? `today's ${describeItem(original)} moves to a later training day or rolls forward, nothing is dropped`
    : option.from !== null
      ? `${WEEKDAY_LABELS[weekdayIndexMondayFirst(option.from)]} becomes a rest day`
      : 'today becomes a training day'
  const warning =
    pinned &&
    (isHardCardio(pinned.prescription) || pinned.prescription.kind === 'long') &&
    isBeforeHeavyLower(plan, dateIso, input, fixed)
      ? ' Tomorrow is a heavy lower day, which this session is normally kept clear of — go by how your legs feel.'
      : ''

  plan.explanations.unshift(
    `${label(dateIso)} replaced with ${describeItem(placed)} ${origin} — ${consequence}.${warning}`,
  )

  return plan
}

/** `isDayBeforeHeavyLower` over a finished week, next week's first strength day included. */
function isBeforeHeavyLower(
  plan: ComposedWeek,
  dateIso: string,
  input: ComposeWeekInput,
  fixed: Map<string, PlannedItem>,
): boolean {
  const slots: StrengthSlot[] = plan.days.flatMap((entry) =>
    entry.planned?.kind === 'strength' ? [{ date: entry.date, programDay: entry.planned.programDay }] : [],
  )
  // `nextWeekSlot` wants how many of the slots the cursor fed — the logged ones it did not.
  const step = slots.filter((slot) => !fixed.has(slot.date)).length

  return isDayBeforeHeavyLower(dateIso, [...slots, ...nextWeekSlot(slots, input, step)], input.heavyLowerDays)
}

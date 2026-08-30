/**
 * The series ProgressView charts, and the two summaries it shows as text.
 *
 * Deliberately a second file rather than more of `stats.ts`: everything here is
 * a *series over time* built for one screen, while `stats.ts` answers "what is
 * true right now". Keeping them apart also keeps `stats.ts` — which the session
 * loop depends on — out of the blast radius of a chart change.
 *
 * Same discipline as the rest of `src/training`: no clock, no store, no Vue.
 * Every window comes in as an ISO day.
 */

import { add, convert, format, multiply, type Unit, type Weight, weight as makeWeight } from '@/liftoscript/weight'
import { canonicalName } from '@/training/exercises'
import type { ReadinessBand } from '@/training/readiness'
import { readinessBand, scoreReadiness } from '@/training/readiness'
import { planWeek } from '@/training/schedule'
import {
  estimatedOneRepMax,
  personalRecords,
  type RecordKind,
  sessionExerciseKey,
  weeklyRollup,
} from '@/training/stats'
import type { Profile, Session, WeightValue } from '@/types'
import { addDays, startOfWeekMonday, WEEK_LENGTH } from '@/utils/date'

export interface LiftProgressPoint {
  /** ISO day, ascending, exactly one per day the lift was trained. */
  date: string
  /** Heaviest completed set that day. */
  workingWeight: WeightValue
  /** Best Epley estimate that day. */
  e1rm: WeightValue
  /** Reps of the set that produced `e1rm`. */
  reps: number
}

export interface WeeklySeriesPoint {
  weekStart: string
  doneMinutes: number
  plannedMinutes: number
  strengthDone: number
  strengthPlanned: number
  tonnage: WeightValue
}

export interface LiftChoice {
  /** A `programState` / `sessionExerciseKey` key, e.g. `'T1:Squat'`. */
  key: string
  /** `'Squat (T1)'`. */
  label: string
  /** Days carrying at least one completed set of this lift. */
  sessionCount: number
}

export interface ReadinessSplit {
  /** Sessions carrying a readiness answer at all. */
  scoredSessions: number
  /** Mean strength tonnage on `good` days. */
  highMeanTonnage: WeightValue | null
  /** Mean strength tonnage on `ok` / `poor` days. */
  lowMeanTonnage: WeightValue | null
  meanReadiness: number | null
  bestBand: ReadinessBand | null
}

/** One line of the PR table: lift, which record, its value, its date. */
export interface RecordRow {
  /** Stable row key — the exercise key plus the record kind. */
  id: string
  exerciseKey: string
  lift: string
  kind: RecordKind
  /** `'Best weight'` / `'Best est. 1RM'` / `'Best AMRAP'`. */
  label: string
  /** Already formatted, so nothing downstream has to know the unit. */
  value: string
  date: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDoneStrength(session: Session): boolean {
  return session.status === 'done' && session.kind === 'strength'
}

function toUnit(value: WeightValue, unit: Unit): WeightValue {
  return convert(value, unit)
}

/**
 * Weight moved in ONE session, in `unit`.
 *
 * The single home for the rule. `weeklyTonnage` answers the same question for a
 * calendar week and cannot be narrowed to one document, and the two callers here
 * — the readiness split and HistoryView's row subtitle — must not drift apart on
 * what counts as a completed set.
 */
export function sessionTonnage(session: Session, unit: Unit): WeightValue {
  let total: Weight = makeWeight(0, unit)

  for (const exercise of session.exercises ?? []) {
    for (const set of exercise.sets) {
      if (set.completedReps === null || set.completedReps <= 0) continue
      total = add(total, multiply(set.weight, set.completedReps))
    }
  }

  return total
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** `'T1:Squat'` → `'Squat (T1)'`; a key with no tier keeps its plain name. */
function labelOfKey(key: string): string {
  const separator = key.indexOf(':')
  if (separator < 0) return canonicalName(key)

  return `${canonicalName(key.slice(separator + 1))} (${key.slice(0, separator)})`
}

// ---------------------------------------------------------------------------
// Per-lift series
// ---------------------------------------------------------------------------

/**
 * One point per DAY, not per session.
 *
 * Two sessions on one day collapse into the better of the two: the chart's x
 * axis is real time, so two markers on one date would stack on top of each
 * other and only the last one drawn would be readable. Everything is converted
 * to a single unit here because a chart has exactly one y axis, and a log that
 * mixes kg and lb would otherwise plot 100 kg below 200 lb.
 */
export function liftProgress(sessions: Session[], key: string, unit: Unit = 'kg'): LiftProgressPoint[] {
  const byDay = new Map<string, LiftProgressPoint>()

  for (const session of sessions) {
    if (!isDoneStrength(session)) continue

    for (const exercise of session.exercises ?? []) {
      if (sessionExerciseKey(exercise) !== key) continue

      for (const set of exercise.sets) {
        const reps = set.completedReps
        if (reps === null || reps <= 0) continue

        const estimate = estimatedOneRepMax(set)
        if (estimate === null) continue

        const working = toUnit(set.weight, unit)
        const e1rm = toUnit(estimate, unit)
        const existing = byDay.get(session.date)

        if (!existing) {
          byDay.set(session.date, { date: session.date, workingWeight: working, e1rm, reps })
          continue
        }

        // The two axes are independent: the heaviest bar of the day and the
        // best estimate of the day need not come from the same set, and
        // pinning both to one set would under-report whichever lost.
        if (working.value > existing.workingWeight.value) existing.workingWeight = working
        if (e1rm.value > existing.e1rm.value) {
          existing.e1rm = e1rm
          existing.reps = reps
        }
      }
    }
  }

  // Ascending regardless of the order the sessions arrived in — the store hands
  // history over newest first.
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Weekly series
// ---------------------------------------------------------------------------

/**
 * `weeks` consecutive weeks from `fromWeekStart`, oldest first.
 *
 * Each week is composed WITHOUT a frontier, exactly as `buildToday` composes
 * its tiles: a frontier trims a week down to what is still to come, so a past
 * week would read "0 planned" and the target line would collapse to nothing.
 * The question this series answers is what the week ASKED for against what was
 * done.
 */
export function weeklySeries(
  profile: Profile,
  sessions: Session[],
  fromWeekStart: string,
  weeks: number,
): WeeklySeriesPoint[] {
  const start = startOfWeekMonday(fromWeekStart)
  const points: WeeklySeriesPoint[] = []

  for (let index = 0; index < Math.max(0, Math.trunc(weeks)); index += 1) {
    const weekStart = addDays(start, index * WEEK_LENGTH)
    const plan = planWeek(profile, sessions, weekStart)
    const rollup = weeklyRollup(profile, sessions, weekStart, plan.week)

    points.push({
      weekStart,
      doneMinutes: rollup.cardio.doneMinutes,
      plannedMinutes: rollup.cardio.plannedMinutes,
      strengthDone: rollup.strength.done,
      strengthPlanned: rollup.strength.planned,
      tonnage: rollup.tonnage,
    })
  }

  return points
}

// ---------------------------------------------------------------------------
// The chart selector
// ---------------------------------------------------------------------------

/**
 * Every lift the athlete could pick a chart for.
 *
 * The union of the program and the log, not either alone: a lift dropped from
 * the program still has history worth looking at, and a lift added yesterday is
 * in the picker before its first session so the athlete can see it is there.
 * A never-trained lift sorts last and reports `0` rather than being hidden —
 * the chart then says "no sets logged for this lift yet", which is the true
 * answer, and hiding it would read as the lift not existing.
 */
export function liftCatalogue(profile: Profile, sessions: Session[]): LiftChoice[] {
  const days = new Map<string, Set<string>>()

  for (const session of sessions) {
    if (!isDoneStrength(session)) continue

    for (const exercise of session.exercises ?? []) {
      if (!exercise.sets.some((set) => set.completedReps !== null && set.completedReps > 0)) continue
      const key = sessionExerciseKey(exercise)
      const seen = days.get(key) ?? new Set<string>()
      seen.add(session.date)
      days.set(key, seen)
    }
  }

  const keys = new Set([...Object.keys(profile.strengthTrack.programState), ...days.keys()])

  return [...keys]
    .map((key) => ({ key, label: labelOfKey(key), sessionCount: days.get(key)?.size ?? 0 }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// Readiness vs performance
// ---------------------------------------------------------------------------

/**
 * DECISION: two means and a count, never a scatter and never a correlation.
 *
 * The performance axis is stated outright — strength tonnage per session — and
 * the split is the one the bands already make: `good` days against `ok`/`poor`
 * days. Readiness is optional and frequently skipped, so at MVP n a cloud of
 * points would invite a claim the data cannot carry. An empty bucket returns
 * `null` rather than a zero, because "no green days logged" and "green days
 * moved nothing" are different facts.
 */
export function readinessSplit(profile: Profile, sessions: Session[]): ReadinessSplit {
  const unit = profile.settings.units
  const scored = sessions.filter((session) => isDoneStrength(session) && session.readiness !== undefined)

  const totals = scored.map((session) => scoreReadiness(session.readiness!).total)
  const byBand = new Map<ReadinessBand, number[]>()

  const high: number[] = []
  const low: number[] = []

  for (const session of scored) {
    const band = readinessBand(scoreReadiness(session.readiness!).total)
    const tonnage = sessionTonnage(session, unit).value

    byBand.set(band, [...(byBand.get(band) ?? []), tonnage])
    if (band === 'good') high.push(tonnage)
    else low.push(tonnage)
  }

  const highMean = mean(high)
  const lowMean = mean(low)

  let bestBand: ReadinessBand | null = null
  let bestMean = -Infinity
  for (const [band, values] of byBand) {
    const value = mean(values) ?? -Infinity
    if (value > bestMean) {
      bestMean = value
      bestBand = band
    }
  }

  const meanReadiness = mean(totals)

  return {
    scoredSessions: scored.length,
    highMeanTonnage: highMean === null ? null : { value: round(highMean), unit },
    lowMeanTonnage: lowMean === null ? null : { value: round(lowMean), unit },
    meanReadiness: meanReadiness === null ? null : round(meanReadiness),
    bestBand,
  }
}

// ---------------------------------------------------------------------------
// The PR table
// ---------------------------------------------------------------------------

const RECORD_LABELS: Record<RecordKind, string> = {
  weight: 'Best weight',
  e1rm: 'Best est. 1RM',
  amrapReps: 'Best AMRAP',
}

/** The order the three records read in when a lift set more than one. */
const RECORD_ORDER: RecordKind[] = ['weight', 'e1rm', 'amrapReps']

/**
 * `personalRecords` flattened into rows, newest record first.
 *
 * Formatting happens here rather than in the view for the usual reason: the
 * unit is a domain fact, and a `.vue` file that formats a weight is a `.vue`
 * file that will eventually format it differently from everywhere else.
 *
 * Everything is converted to `unit` first, exactly as `liftProgress` does. A set
 * keeps whatever unit it was prescribed in, and `settings.units` is switchable,
 * so without this the chart above the table would read lb while the table below
 * it read kg — for the same lift, with nothing saying which is which.
 */
export function recordRows(sessions: Session[], unit: Unit = 'kg'): RecordRow[] {
  const rows: RecordRow[] = []

  for (const record of Object.values(personalRecords(sessions))) {
    const lift = canonicalName(record.name)
    const base = { exerciseKey: record.exerciseKey, lift }

    if (record.bestWeight) {
      rows.push({
        ...base,
        id: `${record.exerciseKey}:weight`,
        kind: 'weight',
        label: RECORD_LABELS.weight,
        value: `${format(toUnit(record.bestWeight.weight, unit))} × ${record.bestWeight.reps}`,
        date: record.bestWeight.date,
      })
    }

    if (record.bestE1rm) {
      rows.push({
        ...base,
        id: `${record.exerciseKey}:e1rm`,
        kind: 'e1rm',
        label: RECORD_LABELS.e1rm,
        value: format(toUnit(record.bestE1rm.weight, unit)),
        date: record.bestE1rm.date,
      })
    }

    if (record.bestAmrapReps) {
      rows.push({
        ...base,
        id: `${record.exerciseKey}:amrapReps`,
        kind: 'amrapReps',
        label: RECORD_LABELS.amrapReps,
        value: `${record.bestAmrapReps.reps} reps @ ${format(toUnit(record.bestAmrapReps.weight, unit))}`,
        date: record.bestAmrapReps.date,
      })
    }
  }

  return rows.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      a.lift.localeCompare(b.lift) ||
      RECORD_ORDER.indexOf(a.kind) - RECORD_ORDER.indexOf(b.kind),
  )
}

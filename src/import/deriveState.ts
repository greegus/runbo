/**
 * Recovering where the athlete actually is in their program, from imported
 * history plus the program they pasted.
 *
 * The output is a drop-in replacement for the three `Profile.strengthTrack`
 * fields `createDefaultProfile` builds — `programState` keyed by
 * `exerciseKey()`, and `rotationCursor` — because the onboarding wizard writes
 * exactly that after the user confirms it.
 *
 * Two rules shape the whole module.
 *
 * **Seed, then replay.** We never compute the *next* stage arithmetically. We
 * recover the stage the athlete *performed*, hand that plus the observed weight
 * to runbo's own `evaluateSession`, and let the program's progression script
 * decide what comes next. A second implementation of GZCLP's stage rules living
 * here is how the two copies start to disagree.
 *
 * **Uncertainty is data, not a silent default.** Every derived number carries a
 * `Confidence`, and `report.needsReview` names the keys the confirmation screen
 * has to pre-highlight. A wrong stage or cursor is invisible until the athlete
 * is under a bar at the wrong weight, so "index 1" returned confidently and
 * "index 1 because nothing matched" must not look the same to the caller.
 *
 * Pure: no clock, no I/O. Sessions and settings come in as parameters.
 */

import type { Diagnostic } from '@/liftoscript/diagnostics'
import { evaluateSession, exerciseKey } from '@/liftoscript/evaluator'
import { parseProgram } from '@/liftoscript/parser'
import type { ExerciseLine, Program, SetGroup } from '@/liftoscript/types'
import { compare } from '@/liftoscript/weight'
import { canonicalName } from '@/training/exercises'
import { GZCLP_ROTATION, initialProgramState, nextCursor, programDayAt } from '@/training/gzclp'
import { evalContextFromSettings, type GymSettings } from '@/training/plates'
import { sessionExerciseKey } from '@/training/stats'
import type { ExerciseState, Session, SetLog, WeightValue } from '@/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * How much the derivation trusts a number.
 * - `certain` — the evidence is unambiguous (a completed set; an exact shape match).
 * - `likely`  — one candidate survived, but only after loosening the comparison.
 * - `guess`   — nothing matched, or several things matched equally well. The
 *               value is still the best available answer, and the user must see it.
 */
export type Confidence = 'certain' | 'likely' | 'guess'

/**
 * Which comparison found the set variation. They are tried in this order and
 * the first one that yields exactly one candidate wins.
 */
export type VariationMatchKind =
  | 'exact' // groups, counts, targets, rep ranges and AMRAP flags all agree
  | 'countAndReps' // as above, ignoring the AMRAP flags
  | 'repPattern' // same total sets and the same multiset of per-set targets
  | 'label' // a logged set label matches a group label — GZCLP's '(5RM Test)'
  | 'totalSets' // last resort: the number of sets alone

/** Why a logged exercise could not be attached to a program line. */
export type UnmatchedReason =
  | 'not-in-program' // no line of that name, at any tier
  | 'ambiguous-tier' // the log carries no tier and several tiers of that name exist

export interface UnmatchedExercise {
  /** The key we looked for, so the message can name it. */
  key: string
  name: string
  tier?: 1 | 2 | 3
  reason: UnmatchedReason
  /** ISO date of the most recent session that logged it. */
  lastLoggedDate: string
  /** For `ambiguous-tier`: the program keys that could have been meant. */
  candidateKeys?: string[]
}

/** What we concluded about one program exercise that has logged history. */
export interface ExerciseDerivation {
  key: string
  name: string
  tier?: 1 | 2 | 3
  /** ISO date of the session the weight and the stage were read from. */
  lastLoggedDate: string
  /** How the key was reached: straight from the log, or inferred. */
  keyResolution: 'logged' | 'tier-inferred-by-key' | 'tier-inferred-by-shape' | 'tier-dropped'
  weight: {
    /** The last completed working weight, or `null` when nothing was ever completed. */
    value: WeightValue | null
    confidence: Confidence
  }
  variation: {
    /**
     * The stage the athlete performed, 1-based. `null` when nothing matched —
     * which is also how a stage the program has no counterpart for reads (a
     * Liftosaur GZCLP T1 in its `1x5 (5RM Test)` stage against runbo's three T1
     * variations). There is deliberately no separate `clamped` flag: every
     * candidate is enumerated from `setVariations`, so a matched index is always
     * inside the program's range and such a flag could only ever be `false`.
     */
    performedIndex: number | null
    /** What we stored as `setVariationIndex` before replay — never `null`. */
    seededIndex: number
    confidence: Confidence
    match: VariationMatchKind | null
    /** The logged scheme in the engine's house format, e.g. `'10x1+'`. */
    loggedShape: string
    /** Populated when several variations matched equally well. */
    tiedCandidates?: { index: number; shape: string }[]
  }
  /** True when `evaluateSession` ran and produced the state for the NEXT session. */
  replayed: boolean
  /** Present when the replay failed; the observed stage and weight were kept as-is. */
  replayDiagnostics?: Diagnostic[]
}

/** How `rotationCursor` was arrived at. */
export type CursorSource =
  | 'gzclp-rotation' // the last logged day is one of A1/B1/A2/B2
  | 'program-days' // the last logged day exists in the program, but off-rotation
  | 'unknown-day' // the day name is not in this program — the athlete changed programs
  | 'no-program-day' // nothing logged carried a program day

export interface CursorDerivation {
  value: number
  source: CursorSource
  confidence: Confidence
  /** The day the cursor was derived FROM, when there was one. */
  lastProgramDay?: string
  /** The day the cursor now points AT, when the program has one. */
  nextProgramDay?: string
  /**
   * True when the last session's own program day trains nothing it logged —
   * the label and the content disagree, so the cursor derived from that label
   * is built on sand. Flagged, never corrected: the confirmation screen is
   * editable, and silently overriding the athlete's position is worse.
   */
  suspect: boolean
}

export interface DeriveReport {
  /**
   * Straight from `parseProgram`, in order and with their wording intact. When
   * this contains an error nothing is derived at all: the caller shows
   * `DiagnosticsList` and offers the built-in GZCLP fallback instead.
   */
  diagnostics: Diagnostic[]
  /** False when the program could not be parsed and run; everything else is then empty. */
  derived: boolean
  /** Number of `status: 'done'` strength sessions that contributed evidence. */
  sessionsRead: number
  exercises: ExerciseDerivation[]
  unmatched: UnmatchedExercise[]
  cursor: CursorDerivation
  /**
   * Exercise keys the confirmation screen must pre-highlight, plus the literal
   * `'rotationCursor'` when the cursor itself is a guess. Anything not `certain`
   * lands here. This is the "explicit uncertain signal" — a caller that ignores
   * every other field still knows what a human has to look at.
   */
  needsReview: string[]
}

export interface DerivedState {
  programState: Record<string, ExerciseState>
  rotationCursor: number
  report: DeriveReport
}

export interface DeriveStateOptions {
  /** Imported history. Only `status: 'done'` strength sessions are read. */
  sessions: Session[]
  /** The adopted program source, verbatim. Parsed here, once. */
  programText: string
  /** The profile's gym half — units, bar and plates, for the replay context. */
  settings: GymSettings
  /**
   * DECISION: the starting state is a parameter so the wizard can hand in the
   * one `adoptProgramText` already built (which carries the weights the program
   * text itself declares). Defaults to `initialProgramState(programText, {})`,
   * i.e. every lift unknown and ask-weight — which is exactly what an exercise
   * with no logged history should keep.
   *
   * An EMPTY object is treated as absent rather than as a program with no
   * exercises: `{}` is what `adoptProgramText` returns for a program it refused,
   * and nobody means it as a starting state.
   */
  baseProgramState?: Record<string, ExerciseState>
}

// ---------------------------------------------------------------------------
// Program day helpers
//
// `cursorOfDay` and `slotOf` also exist, privately, in `src/stores/sessions.ts`
// (`finishSession` computes `nextCursor(cursorOfDay(...))`). They are exported
// here so the store can import them instead: two copies of the wrap logic is
// how the finish path and the import path start to disagree about where the
// athlete is.
// ---------------------------------------------------------------------------

/** The rotation index a GZCLP program day sits at, or `null` for an off-rotation day. */
export function cursorOfDay(programDay: string | undefined): number | null {
  const index = GZCLP_ROTATION.indexOf(programDay as (typeof GZCLP_ROTATION)[number])
  return index >= 0 ? index : null
}

/** The 1-based `week`/`day` slot a program day sits at; the first slot when it is not found. */
export function programSlotOf(program: Program, programDay: string | undefined): { week: number; day: number } {
  for (const [weekIndex, week] of program.weeks.entries()) {
    const dayIndex = week.days.findIndex((day) => day.name === programDay)
    if (dayIndex >= 0) return { week: weekIndex + 1, day: dayIndex + 1 }
  }
  return { week: 1, day: 1 }
}

/** One program exercise line plus where it sits, so the replay resolves the right line. */
interface ProgramExercise {
  key: string
  line: ExerciseLine
  week: number
  day: number
  dayName: string
}

interface FlatDay {
  name: string
  week: number
  day: number
  exercises: ExerciseLine[]
}

function flattenDays(program: Program): FlatDay[] {
  const days: FlatDay[] = []
  for (const [weekIndex, week] of program.weeks.entries()) {
    for (const [dayIndex, day] of week.days.entries()) {
      days.push({ name: day.name, week: weekIndex + 1, day: dayIndex + 1, exercises: day.exercises })
    }
  }
  return days
}

/**
 * The spellings a program line can be reached by, besides its own key.
 *
 * Two seams make this necessary. The importer canonicalizes every logged name
 * through the exercise catalog, so a program line written under an alias
 * (`T1: OHP`) has to be reachable as `T1:Overhead Press`. And `sessionExerciseKey`
 * always builds an upper-case `T1:` label while the parser keeps the label the
 * athlete typed, so a program written `t1:` has to be reachable as `T1:`.
 */
function aliasKeysOf(line: ExerciseLine): string[] {
  const names = new Set([line.name, canonicalName(line.name)])
  const labels = new Set(line.label === undefined ? [undefined] : [line.label, line.label.toUpperCase()])

  const keys = new Set<string>()
  for (const name of names) {
    for (const label of labels) keys.add(exerciseKey({ name, ...(label === undefined ? {} : { label }) }))
  }
  return [...keys]
}

/**
 * Every exercise key in the program with the line it resolves to. The same lift
 * on two days shares one progression and the FIRST line wins — the rule
 * `initialProgramState` already applies, mirrored here so a duplicated key
 * cannot be replayed against a different line than it was stated from.
 *
 * Aliases are added in a second pass, after every literal key exists, so an
 * alias can never shadow a line that is spelled that way for real. Each entry
 * keeps its own `key` — the program's spelling — because that is what
 * `programState` is keyed by.
 */
function indexProgram(program: Program): Map<string, ProgramExercise> {
  const index = new Map<string, ProgramExercise>()
  const aliases: [string, ProgramExercise][] = []

  for (const day of flattenDays(program)) {
    for (const line of day.exercises) {
      const key = exerciseKey(line)
      if (index.has(key)) continue
      const entry = { key, line, week: day.week, day: day.day, dayName: day.name }
      index.set(key, entry)
      for (const alias of aliasKeysOf(line)) if (alias !== key) aliases.push([alias, entry])
    }
  }

  for (const [alias, entry] of aliases) if (!index.has(alias)) index.set(alias, entry)
  return index
}

// ---------------------------------------------------------------------------
// Working weight
// ---------------------------------------------------------------------------

/**
 * A working set is one the athlete actually completed reps on.
 *
 * `completedReps === null` is untouched — the set was prescribed and never
 * logged, so it carries no evidence about the weight. `completedReps === 0` is
 * a set deliberately marked done at zero (a miss, or a skip); it is real
 * evidence about the STAGE, which is why the shape matcher still counts it, but
 * it is not evidence that the athlete moved that weight.
 *
 * Warmups never reach here: `SetLog` has no warmup flag and the Liftosaur
 * mapper drops `warmupSets` before a session is ever built.
 */
function isCompletedWorkingSet(set: SetLog): boolean {
  return set.completedReps !== null && set.completedReps > 0
}

/**
 * The heaviest completed set, not the last one.
 *
 * GZCLP's T1 AMRAP is the same weight as the straight sets, so "last" and
 * "heaviest" usually agree — but an ad-hoc back-off set logged after the work
 * sets is lighter and must not become the working weight. Ties go to the
 * earliest set, so the first working set's weight is the one kept.
 */
function lastCompletedWorkingWeight(sets: SetLog[]): WeightValue | null {
  let best: WeightValue | null = null
  for (const set of sets) {
    if (!isCompletedWorkingSet(set)) continue
    if (best === null || compare(set.weight, best) > 0) best = set.weight
  }
  return best === null ? null : { ...best }
}

// ---------------------------------------------------------------------------
// Set-scheme shapes
// ---------------------------------------------------------------------------

/** A group of consecutive identical sets, recovered from a log or read off the AST. */
interface Shape {
  count: number
  /** What the set targets — `SetGroup.maxReps ?? SetGroup.reps`, `SetLog.prescribedReps`. */
  target: number
  /** The range minimum, only when the prescription is a range. */
  minReps?: number
  isAmrap: boolean
  label?: string
}

/**
 * The house format for a set scheme: `count x reps[-max][+]`, groups joined
 * with `', '` — `'5x3+'`, `'1x5, 1x3, 3x5'`.
 *
 * This duplicates `formatVariation` in `liftoscript/evaluator.ts`, which is
 * private. A second spelling of the same thing in the UI would be worse than a
 * duplicated three-liner; the evaluator should export its copy and this should
 * call it.
 */
export function formatShape(shape: Shape[]): string {
  return shape
    .map((group) => {
      const reps =
        group.minReps === undefined ? String(group.target) : `${String(group.minReps)}-${String(group.target)}`
      return `${String(group.count)}x${reps}${group.isAmrap ? '+' : ''}`
    })
    .join(', ')
}

/**
 * The scheme the athlete actually performed. Consecutive sets sharing
 * prescription and weight form one group, and a skipped set still counts — it
 * was part of the prescription and carries its `prescribedReps`.
 *
 * `prescribe` flags AMRAP on the group's LAST set only, so the group is AMRAP
 * when any of its sets is.
 */
function loggedShape(sets: SetLog[]): Shape[] {
  const groups: Shape[] = []
  let previous: SetLog | undefined

  for (const set of sets) {
    const continues =
      previous !== undefined &&
      previous.prescribedReps === set.prescribedReps &&
      previous.minReps === set.minReps &&
      compare(previous.weight, set.weight) === 0

    if (continues) {
      const last = groups[groups.length - 1]
      last.count += 1
      last.isAmrap ||= set.isAmrap
      last.label ??= set.label
    } else {
      groups.push({
        count: 1,
        target: set.prescribedReps,
        ...(set.minReps === undefined ? {} : { minReps: set.minReps }),
        isAmrap: set.isAmrap,
        ...(set.label === undefined ? {} : { label: set.label }),
      })
    }
    previous = set
  }

  return groups
}

/**
 * A program variation as a shape. Note the direction of the range fields: in
 * the AST `reps` is the range MINIMUM and `maxReps` the max, while a `SetLog`
 * carries the target in `prescribedReps` and the minimum in `minReps`.
 */
function variationShape(groups: SetGroup[]): Shape[] {
  return groups.map((group) => ({
    count: group.count,
    target: group.maxReps ?? group.reps,
    ...(group.maxReps === undefined ? {} : { minReps: group.reps }),
    isAmrap: group.isAmrap,
    ...(group.label === undefined ? {} : { label: group.label }),
  }))
}

function totalSets(shape: Shape[]): number {
  return shape.reduce((sum, group) => sum + group.count, 0)
}

/** Every set's target, expanded and sorted — the multiset the `repPattern` tier compares. */
function perSetTargets(shape: Shape[]): number[] {
  const targets: number[] = []
  for (const group of shape) for (let i = 0; i < group.count; i += 1) targets.push(group.target)
  return targets.sort((a, b) => a - b)
}

function sameLength<T>(a: T[], b: T[]): boolean {
  return a.length === b.length
}

function matchesExact(logged: Shape[], candidate: Shape[]): boolean {
  if (!sameLength(logged, candidate)) return false
  return logged.every((group, index) => {
    const other = candidate[index]
    return (
      group.count === other.count &&
      group.target === other.target &&
      group.minReps === other.minReps &&
      group.isAmrap === other.isAmrap
    )
  })
}

function matchesCountAndReps(logged: Shape[], candidate: Shape[]): boolean {
  if (!sameLength(logged, candidate)) return false
  return logged.every(
    (group, index) => group.count === candidate[index].count && group.target === candidate[index].target,
  )
}

function matchesRepPattern(logged: Shape[], candidate: Shape[]): boolean {
  if (totalSets(logged) !== totalSets(candidate)) return false
  const a = perSetTargets(logged)
  const b = perSetTargets(candidate)
  return a.every((value, index) => value === b[index])
}

function normalizeLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}

/** GZCLP's `(5RM Test)` survives into `SetLog.label`, and its `1x5` shape is otherwise unremarkable. */
function matchesLabel(logged: Shape[], candidate: Shape[]): boolean {
  const labels = new Set(logged.map((group) => normalizeLabel(group.label)).filter((label) => label !== undefined))
  if (labels.size === 0) return false
  return candidate.some((group) => {
    const label = normalizeLabel(group.label)
    return label !== undefined && labels.has(label)
  })
}

function matchesTotalSets(logged: Shape[], candidate: Shape[]): boolean {
  return totalSets(logged) === totalSets(candidate)
}

const MATCHERS: { kind: VariationMatchKind; test: (logged: Shape[], candidate: Shape[]) => boolean }[] = [
  { kind: 'exact', test: matchesExact },
  { kind: 'countAndReps', test: matchesCountAndReps },
  { kind: 'repPattern', test: matchesRepPattern },
  { kind: 'label', test: matchesLabel },
  { kind: 'totalSets', test: matchesTotalSets },
]

interface VariationMatch {
  /** 1-based, or `null` when no tier produced a candidate. */
  index: number | null
  match: VariationMatchKind | null
  confidence: Confidence
  tied?: { index: number; shape: string }[]
}

/**
 * Match a logged scheme against a program exercise's variations.
 *
 * The tiers are tried in order and the first one that yields exactly ONE
 * candidate wins. A tier that yields several stops the search too: the looser
 * tiers are supersets of the stricter ones, so they can only ever tie harder.
 * A tie takes the lowest index and says so — GZCLP's T1 5/6/10-set shapes and
 * T2 10/8/6-rep shapes never tie, so a tie means the program is not shaped the
 * way the log is and a human should look.
 */
function matchVariation(exercise: ExerciseLine, logged: Shape[]): VariationMatch {
  const candidates = exercise.setVariations.map((groups, index) => ({
    index: index + 1,
    shape: variationShape(groups),
  }))
  if (candidates.length === 0 || logged.length === 0) {
    return { index: null, match: null, confidence: 'guess' }
  }

  for (const matcher of MATCHERS) {
    const hits = candidates.filter((candidate) => matcher.test(logged, candidate.shape))
    if (hits.length === 0) continue

    if (hits.length === 1) {
      return {
        index: hits[0].index,
        match: matcher.kind,
        // Only an exact agreement is worth calling certain; everything below it
        // survived by ignoring something the athlete actually logged.
        confidence: matcher.kind === 'exact' ? 'certain' : 'likely',
      }
    }

    return {
      index: hits[0].index,
      match: matcher.kind,
      confidence: 'guess',
      tied: hits.map((hit) => ({ index: hit.index, shape: formatShape(hit.shape) })),
    }
  }

  return { index: null, match: null, confidence: 'guess' }
}

// ---------------------------------------------------------------------------
// Collecting the evidence
// ---------------------------------------------------------------------------

type LoggedExercise = NonNullable<Session['exercises']>[number]

interface Evidence {
  session: Session
  exercise: LoggedExercise
}

/** Oldest first, so "the last one" is the end of every list. */
function orderedStrengthSessions(sessions: Session[]): Session[] {
  return sessions
    .filter(
      (session) => session.status === 'done' && session.kind === 'strength' && (session.exercises?.length ?? 0) > 0,
    )
    .slice()
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
}

interface KeyResolution {
  key: string | null
  how: ExerciseDerivation['keyResolution']
  reason?: UnmatchedReason
  candidateKeys?: string[]
}

/**
 * The program's own key for a logged name, or `undefined` when it has no such
 * line. The logged side is canonicalized too: a session typed by hand never went
 * through the importer, so it can carry an alias just as a program line can.
 * What comes back is always the program's spelling, because `programState` and
 * the replay are both keyed by it.
 */
function lookupKey(programIndex: Map<string, ProgramExercise>, name: string, tier?: 1 | 2 | 3): string | undefined {
  for (const candidate of new Set([name, canonicalName(name)])) {
    const probe = tier === undefined ? candidate : sessionExerciseKey({ name: candidate, tier })
    const hit = programIndex.get(probe)
    if (hit) return hit.key
  }
  return undefined
}

/**
 * Which program line a logged exercise belongs to.
 *
 * A pre-2026-03 Liftosaur export carries no tier at all (the migration that
 * backfilled entry ids dropped the label), so a tier-less log against a tiered
 * program is the common case, not an edge case. We try the tiers by key first,
 * then by set shape, and refuse to pick arbitrarily when both are ambiguous —
 * attaching T2 Squat's history to T1 Squat would put a 3x10 volume weight on a
 * max-effort line.
 */
function resolveKey(
  exercise: LoggedExercise,
  programIndex: Map<string, ProgramExercise>,
  logged: Shape[],
): KeyResolution {
  if (exercise.tier !== undefined) {
    const tiered = lookupKey(programIndex, exercise.name, exercise.tier)
    if (tiered !== undefined) return { key: tiered, how: 'logged' }
    // DECISION: a tiered log against an untiered program line (`Squat` with no
    // `T1:`) is the same exercise under a program that stopped labelling tiers.
    // Falling back to the bare name keeps the history attached; the alternative
    // is discarding real evidence over a label.
    const bare = lookupKey(programIndex, exercise.name)
    if (bare !== undefined) return { key: bare, how: 'tier-dropped' }
    return { key: null, how: 'logged', reason: 'not-in-program' }
  }

  const bare = lookupKey(programIndex, exercise.name)
  if (bare !== undefined) return { key: bare, how: 'logged' }

  const candidateKeys = [
    ...new Set(
      ([1, 2, 3] as const)
        .map((tier) => lookupKey(programIndex, exercise.name, tier))
        .filter((key) => key !== undefined),
    ),
  ]

  if (candidateKeys.length === 0) return { key: null, how: 'logged', reason: 'not-in-program' }
  if (candidateKeys.length === 1) return { key: candidateKeys[0], how: 'tier-inferred-by-key' }

  const byShape = candidateKeys.filter((key) => matchVariation(programIndex.get(key)!.line, logged).index !== null)
  if (byShape.length === 1) return { key: byShape[0], how: 'tier-inferred-by-shape' }

  return { key: null, how: 'logged', reason: 'ambiguous-tier', candidateKeys }
}

// ---------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------

/**
 * The day AFTER the last logged program day.
 *
 * A day name the current program does not have means the athlete changed
 * programs between the export and now. Returning 0 as if they were at the start
 * would silently put them back on day one, so the source says `unknown-day`,
 * the confidence is `guess`, and the wizard asks.
 */
function deriveCursor(sessions: Session[], program: Program): CursorDerivation {
  const days = flattenDays(program)
  const last = [...sessions].reverse().find((session) => session.programDay !== undefined)

  if (!last?.programDay) {
    return { value: 0, source: 'no-program-day', confidence: 'guess', suspect: false }
  }
  const lastProgramDay = last.programDay

  const suspect = isMislabelledDay(days, last)

  const rotationIndex = cursorOfDay(lastProgramDay)
  if (rotationIndex !== null) {
    const value = nextCursor(rotationIndex)
    return {
      value,
      source: 'gzclp-rotation',
      confidence: 'certain',
      lastProgramDay,
      nextProgramDay: programDayAt(value),
      suspect,
    }
  }

  const normalized = lastProgramDay.trim().toLowerCase()
  const index = days.findIndex((day) => day.name.trim().toLowerCase() === normalized)
  if (index >= 0 && days.length > 0) {
    const slot = (index + 1) % days.length
    // A program-day index is NOT the same number as `rotationCursor`: everything
    // downstream reads that field as an index into `GZCLP_ROTATION`
    // (`composeWeek` does `programDays[(cursor + step) % 4]`). Folding it into
    // the rotation's range at least keeps the value in the space its consumers
    // read, but the two only coincide for a four-day program — so this is a
    // `guess` and lands in `needsReview` for the athlete to correct.
    return {
      value: slot % GZCLP_ROTATION.length,
      source: 'program-days',
      confidence: 'guess',
      lastProgramDay,
      nextProgramDay: days[slot].name,
      suspect,
    }
  }

  return { value: 0, source: 'unknown-day', confidence: 'guess', lastProgramDay, suspect: false }
}

/**
 * Does the last session's program day actually train what that session logged?
 *
 * DECISION: the field map phrased this sanity check as "the day the cursor
 * points AT trains nothing the last session logged". That reading is vacuous
 * for GZCLP — consecutive days share no exercise at all, so every import would
 * come back suspect. The check that carries the same intent without firing on
 * every healthy history is the one on the day the session claims to BE: a
 * session labelled A1 that logged deadlifts has a wrong label, and a cursor
 * derived from a wrong label points at the wrong day.
 */
function isMislabelledDay(days: FlatDay[], last: Session): boolean {
  const claimed = days.find((day) => day.name.trim().toLowerCase() === last.programDay?.trim().toLowerCase())
  if (!claimed) return false

  const loggedNames = new Set((last.exercises ?? []).map((exercise) => exercise.name.trim().toLowerCase()))
  if (loggedNames.size === 0) return false

  return !claimed.exercises.some((line) => loggedNames.has(line.name.trim().toLowerCase()))
}

// ---------------------------------------------------------------------------
// deriveState
// ---------------------------------------------------------------------------

function cloneExerciseState(state: ExerciseState): ExerciseState {
  return {
    weights: state.weights.map((item) => ({ ...item })),
    setVariationIndex: state.setVariationIndex,
    state: Object.fromEntries(
      Object.entries(state.state).map(([name, value]) => [name, typeof value === 'number' ? value : { ...value }]),
    ),
    ...(state.askWeight === undefined ? {} : { askWeight: state.askWeight }),
  }
}

function cloneProgramState(programState: Record<string, ExerciseState>): Record<string, ExerciseState> {
  return Object.fromEntries(Object.entries(programState).map(([key, state]) => [key, cloneExerciseState(state)]))
}

function tierOfKey(key: string): 1 | 2 | 3 | undefined {
  const match = /^T([123]):/.exec(key)
  return match ? (Number(match[1]) as 1 | 2 | 3) : undefined
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(Math.round(index), 1), Math.max(count, 1))
}

function emptyReport(diagnostics: Diagnostic[]): DeriveReport {
  return {
    diagnostics,
    derived: false,
    sessionsRead: 0,
    exercises: [],
    unmatched: [],
    cursor: { value: 0, source: 'no-program-day', confidence: 'guess', suspect: false },
    needsReview: [],
  }
}

/**
 * From imported sessions plus the pasted program: the working weight, the stage
 * and the rotation position the athlete is at.
 *
 * Never throws. A program that does not parse comes back `derived: false` with
 * the parser's diagnostics untouched: half-deriving against a program whose
 * broken lines were dropped would attach history to lines the athlete never
 * wrote.
 *
 * That refusal belongs to this function, not to how the state was obtained. It
 * used to ride on `initialProgramState` throwing, but a caller-supplied
 * `baseProgramState` skips that call entirely — and the documented supplier,
 * `adoptProgramText`, hands back a truthy `{}` for exactly the programs it
 * refused to adopt.
 */
export function deriveState(options: DeriveStateOptions): DerivedState {
  const { sessions, programText, settings } = options
  const { program, diagnostics } = parseProgram(programText)

  // Any diagnostic at all, warnings included: that is the bar `initialProgramState`
  // sets, and the bar `adoptProgramText` refuses a program at.
  if (diagnostics.length > 0) {
    return { programState: {}, rotationCursor: 0, report: emptyReport(diagnostics) }
  }

  // An EMPTY base is treated as absent, not as "a program with no exercises":
  // `{}` is what a failed adoption returns, and it is never what a caller means.
  const base =
    options.baseProgramState && Object.keys(options.baseProgramState).length > 0 ? options.baseProgramState : undefined

  let programState: Record<string, ExerciseState>
  try {
    programState = base ? cloneProgramState(base) : initialProgramState(programText, {})
  } catch {
    return { programState: {}, rotationCursor: 0, report: emptyReport(diagnostics) }
  }

  const programIndex = indexProgram(program)
  const ordered = orderedStrengthSessions(sessions)

  // Group the logged evidence per program key, oldest first.
  const byKey = new Map<string, Evidence[]>()
  const unmatched: UnmatchedExercise[] = []
  const resolutions = new Map<string, ExerciseDerivation['keyResolution']>()

  for (const session of ordered) {
    for (const exercise of session.exercises ?? []) {
      const shape = loggedShape(exercise.sets)
      const resolved = resolveKey(exercise, programIndex, shape)

      if (resolved.key === null) {
        const key = sessionExerciseKey({ name: exercise.name, ...(exercise.tier ? { tier: exercise.tier } : {}) })
        // One row per logged exercise, newest date wins — the wizard lists the
        // exercise, not every session it appeared in.
        const existing = unmatched.find((entry) => entry.key === key)
        if (existing) existing.lastLoggedDate = session.date
        else
          unmatched.push({
            key,
            name: exercise.name,
            ...(exercise.tier ? { tier: exercise.tier } : {}),
            reason: resolved.reason ?? 'not-in-program',
            lastLoggedDate: session.date,
            ...(resolved.candidateKeys ? { candidateKeys: resolved.candidateKeys } : {}),
          })
        continue
      }

      if (!programState[resolved.key]) {
        // The program has the line but `initialProgramState` did not key it —
        // it cannot happen with the current helper, and inventing a state here
        // would bypass the progression's `stateInit`. Treat it as unmatched.
        unmatched.push({
          key: resolved.key,
          name: exercise.name,
          ...(exercise.tier ? { tier: exercise.tier } : {}),
          reason: 'not-in-program',
          lastLoggedDate: session.date,
        })
        continue
      }

      resolutions.set(resolved.key, resolved.how)
      const list = byKey.get(resolved.key)
      if (list) list.push({ session, exercise })
      else byKey.set(resolved.key, [{ session, exercise }])
    }
  }

  const derivations: ExerciseDerivation[] = []

  for (const [key, evidence] of byKey) {
    const programExercise = programIndex.get(key)!
    const tier = tierOfKey(key)

    // Newest first: the last SESSION that completed anything is the evidence.
    //
    // One session can carry the same key twice — Liftosaur entry ids are not
    // unique within a day, and an ad-hoc back-off entry logged after the work
    // sets is ordinary data — so the session's entries are weighed together and
    // the heaviest wins, exactly as `lastCompletedWorkingWeight` does inside one
    // entry. Taking the last entry would let a 1x8 back-off become the working
    // weight, and call it `certain`.
    const bySession = new Map<string, Evidence[]>()
    for (const item of evidence) {
      const group = bySession.get(item.session.id)
      if (group) group.push(item)
      else bySession.set(item.session.id, [item])
    }
    const groups = [...bySession.values()]
    const latestGroup =
      [...groups]
        .reverse()
        .find((group) => group.some((item) => lastCompletedWorkingWeight(item.exercise.sets) !== null)) ??
      groups[groups.length - 1]

    const scored = latestGroup.flatMap((item) => {
      const value = lastCompletedWorkingWeight(item.exercise.sets)
      return value === null ? [] : [{ item, value }]
    })
    let best: { item: Evidence; value: WeightValue } | undefined
    for (const entry of scored) if (best === undefined || compare(entry.value, best.value) > 0) best = entry
    const heaviest = best

    const reference = heaviest?.item ?? latestGroup[latestGroup.length - 1]
    const shape = loggedShape(reference.exercise.sets)
    const weight = heaviest ? { ...heaviest.value } : null
    // Two entries for one key completing different weights: the heaviest is the
    // working weight, but which entry was the work set is a judgement call, so
    // the wizard is asked rather than told.
    const conflicted = heaviest !== undefined && scored.some((entry) => compare(entry.value, heaviest.value) !== 0)

    const base: Omit<ExerciseDerivation, 'weight' | 'variation' | 'replayed'> = {
      key,
      name: programExercise.line.name,
      ...(tier ? { tier } : {}),
      lastLoggedDate: reference.session.date,
      keyResolution: resolutions.get(key) ?? 'logged',
    }

    if (weight === null) {
      // Logged, but nothing was ever completed: only skipped or untouched sets.
      // There is no weight to adopt, so the lift keeps its ask-weight state and
      // the athlete is asked. Guessing a weight off a skipped set is exactly the
      // silent, expensive error this module exists to avoid.
      derivations.push({
        ...base,
        weight: { value: null, confidence: 'guess' },
        variation: {
          performedIndex: null,
          seededIndex: programState[key].setVariationIndex,
          confidence: 'guess',
          match: null,
          loggedShape: formatShape(shape),
        },
        replayed: false,
      })
      continue
    }

    const matched = matchVariation(programExercise.line, shape)
    const rawIndex = matched.index ?? 1
    const seededIndex = clampIndex(rawIndex, programExercise.line.setVariations.length)

    const seeded: ExerciseState = {
      weights: [{ ...weight }],
      setVariationIndex: seededIndex,
      state: { ...programState[key].state },
      // `askWeight` is omitted entirely, not set to false: we know the weight
      // now, and the optional-undefined discipline is what `cloneExerciseState`
      // and the evaluator both preserve.
    }

    // The replay reads its base weight off the LOGGED sets (`buildScope` ->
    // `storedWeights` takes the first distinct one), not off `seeded.weights`,
    // which is only the fallback for an empty log. A ramp-up or back-off set
    // logged among the working sets would otherwise re-base the whole
    // progression on that set — and a reset branch's `weights * resetFactor`
    // would deload off it too. So the log handed to the replay carries the one
    // working weight §5.1 settled on, and a log that was not uniform is no
    // longer called `certain`.
    const uniform = reference.exercise.sets.every((set) => compare(set.weight, weight) === 0)
    const replayLog: SetLog[] = uniform
      ? reference.exercise.sets
      : reference.exercise.sets.map((set) => ({ ...set, weight: { ...weight } }))

    // Replay ONLY the last logged session. The weight from above is already the
    // outcome of every session before it, so replaying more would double-apply
    // the increments.
    const ctx = evalContextFromSettings(settings, { week: programExercise.week, day: programExercise.day })
    const result = evaluateSession(program, key, seeded, replayLog, ctx)
    const failed = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')

    programState[key] = failed ? seeded : result.nextState

    derivations.push({
      ...base,
      weight: { value: { ...weight }, confidence: uniform && !conflicted ? 'certain' : 'likely' },
      variation: {
        performedIndex: matched.index,
        seededIndex,
        confidence: matched.confidence,
        match: matched.match,
        loggedShape: formatShape(shape),
        ...(matched.tied ? { tiedCandidates: matched.tied } : {}),
      },
      replayed: !failed,
      ...(failed ? { replayDiagnostics: result.diagnostics } : {}),
    })
  }

  const cursor = deriveCursor(ordered, program)

  const needsReview = [
    ...derivations
      .filter(
        (derivation) =>
          derivation.weight.confidence !== 'certain' ||
          derivation.variation.confidence !== 'certain' ||
          derivation.keyResolution !== 'logged' ||
          !derivation.replayed,
      )
      .map((derivation) => derivation.key),
    ...unmatched.map((entry) => entry.key),
    ...(cursor.confidence === 'certain' && !cursor.suspect ? [] : ['rotationCursor']),
  ]

  return {
    programState,
    rotationCursor: cursor.value,
    report: {
      diagnostics,
      derived: true,
      sessionsRead: ordered.length,
      exercises: derivations,
      unmatched,
      cursor,
      needsReview,
    },
  }
}

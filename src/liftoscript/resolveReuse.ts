/**
 * Resolves `...Name` references, after the whole program is parsed.
 *
 * It has to be a second pass: a line may point at one that has not been read
 * yet, and Liftosaur's own GZCLP does exactly that.
 *
 * Two forms, with deliberately different rules:
 *
 * - `/ ...t3: Lat Pulldown[1]` copies the target's SETS. The copy is deep, so a
 *   later mutation of one line cannot reach through into the other.
 * - `progress: custom(increase: 2.5kg) { ...t1: Squat }` copies the target's
 *   SCRIPT but keeps this line's own `stateInit`. That split is the point of the
 *   feature: GZCLP runs one progression for every lift, each with its own
 *   increment.
 *
 * A reference that cannot be satisfied is a diagnostic, never a silent no-op —
 * an exercise that quietly ends up with no sets would be a workout the athlete
 * never wrote.
 */

import { createDiagnostic, type Diagnostic } from './diagnostics'
import type { ExerciseLine, Program, ReuseRef, SetGroup } from './types'

/** `T1:Squat` — the label is upper-cased so `t1:` and `T1:` are one name. */
function refKey(ref: { label?: string; name: string }): string {
  return ref.label ? `${ref.label.toUpperCase()}:${ref.name}` : ref.name
}

interface Located {
  exercise: ExerciseLine
  week: number // 1-based
  day: number // 1-based
}

function index(program: Program): Located[] {
  const all: Located[] = []
  program.weeks.forEach((week, weekIndex) => {
    week.days.forEach((day, dayIndex) => {
      for (const exercise of day.exercises) {
        all.push({ exercise, week: weekIndex + 1, day: dayIndex + 1 })
      }
    })
  })
  return all
}

/**
 * The line a reference points at.
 *
 * Coordinates narrow the search rather than being required: a program written
 * as one day (the shape a pasted Liftosaur program often has) still resolves
 * `...Squat[1]`, because there is only one candidate and insisting on the
 * coordinate would reject a reference whose meaning is unambiguous.
 */
function target(all: Located[], ref: ReuseRef, from: ExerciseLine): Located | undefined {
  const key = refKey(ref)
  const named = all.filter((entry) => entry.exercise !== from && refKey(entry.exercise) === key)
  if (named.length === 0) return undefined

  const byDay = ref.day === undefined ? named : named.filter((entry) => entry.day === ref.day)
  const byWeek = ref.week === undefined ? byDay : byDay.filter((entry) => entry.week === ref.week)

  return byWeek[0] ?? byDay[0] ?? named[0]
}

function cloneSets(variations: SetGroup[][]): SetGroup[][] {
  return variations.map((variation) => variation.map((group) => ({ ...group })))
}

/**
 * Fills in every reuse reference in place, appending a diagnostic for each one
 * that cannot be. Safe to call on a program that also has other errors.
 */
export function resolveReuse(program: Program, diagnostics: Diagnostic[], lineAt: (line: number) => string): void {
  const all = index(program)

  function fail(ref: ReuseRef, message: string): void {
    diagnostics.push(createDiagnostic(message, ref.loc, lineAt(ref.loc.line)))
  }

  // Sets first: a script may be reused from a line whose own sets are a copy,
  // and resolving in this order means the second pass sees the finished shape.
  for (const { exercise } of all) {
    const ref = exercise.reuseSets
    if (!ref) continue

    const found = target(all, ref, exercise)
    if (!found) {
      fail(ref, `No exercise named \`${refKey(ref)}\` to reuse. Check the spelling, including the tier label.`)
      continue
    }
    if (found.exercise.reuseSets) {
      fail(ref, `\`${refKey(ref)}\` reuses another exercise itself. Reuse may not chain.`)
      continue
    }
    if (found.exercise.setVariations.length === 0) {
      fail(ref, `\`${refKey(ref)}\` has no sets to reuse.`)
      continue
    }

    exercise.setVariations = cloneSets(found.exercise.setVariations)
  }

  for (const { exercise } of all) {
    const progress = exercise.sections.progress
    if (progress?.kind !== 'custom' || !progress.reuseFrom) continue

    const ref = progress.reuseFrom
    const found = target(all, ref, exercise)
    if (!found) {
      fail(ref, `No exercise named \`${refKey(ref)}\` to reuse a progression from.`)
      continue
    }

    const source = found.exercise.sections.progress
    if (source?.kind !== 'custom') {
      fail(ref, `\`${refKey(ref)}\` has no \`custom(...)\` progression to reuse.`)
      continue
    }
    if (source.reuseFrom) {
      fail(ref, `\`${refKey(ref)}\`'s progression is itself reused. Reuse may not chain.`)
      continue
    }

    // The script is shared, the state is not: `stateInit` stays as this line
    // declared it, which is how each lift keeps its own increment.
    progress.script = source.script
  }
}

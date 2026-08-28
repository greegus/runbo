/**
 * Tolerant mapper: a Liftosaur JSON export -> runbo `Session[]` plus a report.
 *
 * PROVENANCE. Nothing here was validated against a real export. The field names
 * and shapes come from Liftosaur's published TypeScript types (`src/types.ts`,
 * commit `1f8039e`) and its own import/export code paths; the fixtures in
 * `__tests__/fixtures/` are synthetic and derived from the same source. The
 * riskiest guesses carry an `INFERRED:` comment, but that marking is NOT
 * exhaustive — treat every field name here as unconfirmed until someone runs a
 * real export through it. Known-unmarked bets: `entry.index`/`set.index`
 * ordering, `entry.superset`, `set.completedRepsLeft`, `set.minReps`,
 * `set.label`, `settings.exercises`, `storage.deletedHistory`, `record.notes`.
 * A fixture built from a wrong belief passes a mapper built from the same wrong
 * belief, so the green tests below prove consistency, not correctness.
 *
 * Three ideas carry the module:
 *
 * 1. **The input is untrusted.** Every field is read through a narrowing helper;
 *    a wrong type is a missing value, never a throw. `importLiftosaurHistory`
 *    is total: for any input at all it returns a result, and a file it cannot
 *    recognise comes back as a failed report rather than an exception.
 * 2. **Three outcomes, ordered by blast radius** — fail the whole import (three
 *    conditions only, all about the file not being an export at all), skip a
 *    record/entry/set with a reason, or default a single field and note it.
 *    A skip is never silent.
 * 3. **The importer never guesses.** No exercise is substituted for another
 *    (Liftosaur's own CSV export silently turns an unresolvable exercise into
 *    "Squat" — that bug is why we insist on the JSON), and no weight is ever
 *    invented: a set with no usable weight is skipped, not zeroed.
 */

import { convert, isWeight, weight as makeWeight, type Unit, type Weight } from '@/liftoscript/weight'
import { canonicalName, modalityOf, resolveExercise } from '@/training/exercises'
import { GZCLP_ROTATION } from '@/training/gzclp'
import type { Session, SetLog, WeightValue } from '@/types'
import { toIso } from '@/utils/date'

/** Every reason a record, an entry or a set can be skipped or defaulted. */
export type ReasonId =
  // record level
  | 'malformed-record'
  | 'no-entries'
  | 'no-usable-date'
  | 'in-progress'
  | 'deleted'
  | 'duplicate-workout'
  | 'all-entries-skipped'
  | 'cardio-only'
  // entry level
  | 'malformed-entry'
  | 'no-sets'
  | 'all-sets-skipped'
  // set level
  | 'malformed-set'
  | 'no-reps'
  | 'no-weight'
  // non-fatal notes
  | 'unmapped-programDay'
  | 'unknown-exercise'
  | 'tier-unrecoverable'
  | 'superset-flattened'
  | 'warmups-dropped'
  | 'duplicate-id'
  | 'prescribed-reps-defaulted'
  | 'bad-completed-reps'
  | 'unilateral-collapsed'
  | 'in-progress-imported'

/**
 * The wording lives in exactly one table, the way `UNSUPPORTED_CONSTRUCTS` owns
 * the parser's diagnostic wording — the UI groups by `ReasonId` and prints this.
 */
export const IMPORT_REASONS: Record<ReasonId, string> = {
  'malformed-record': 'The workout is not an object.',
  'no-entries': 'The workout has no exercises.',
  'no-usable-date': 'The workout has neither a start time nor a readable date.',
  'in-progress': 'The workout was still in progress and was not finished.',
  deleted: 'The workout was deleted in Liftosaur.',
  'duplicate-workout': 'Another workout starts within a minute of this one.',
  'all-entries-skipped': 'Every exercise of the workout had to be skipped.',
  'cardio-only': 'The workout logs only cardio exercises, which runbo tracks separately.',
  'malformed-entry': 'The exercise is not an object, or has no exercise id.',
  'no-sets': 'The exercise has no sets.',
  'all-sets-skipped': 'Every set of the exercise had to be skipped.',
  'malformed-set': 'The set is not an object.',
  'no-reps': 'The set has neither a prescribed nor a completed rep count.',
  'no-weight': 'The set has no usable weight.',
  'unmapped-programDay': 'The workout does not name its program day.',
  'unknown-exercise': 'The exercise is not in runbo’s catalog; its name was kept as written.',
  'tier-unrecoverable': 'The tier (T1/T2/T3) is not recorded in the export.',
  'superset-flattened': 'Superset grouping was dropped; the exercises were imported side by side.',
  'warmups-dropped': 'Warmup sets were dropped; runbo logs working sets only.',
  'duplicate-id': 'Two workouts share an id; the later one was renamed.',
  'prescribed-reps-defaulted': 'The set had no prescribed reps; the completed reps were used instead.',
  'bad-completed-reps': 'The set’s completed reps were unreadable and were treated as untouched.',
  'unilateral-collapsed': 'Left-side reps were dropped; runbo logs one rep count per set.',
  'in-progress-imported': 'An unfinished workout was imported on request; its reps are prescriptions, not results.',
}

export function reasonMessage(id: ReasonId): string {
  const message = IMPORT_REASONS[id]
  if (!message) throw new Error(`Unknown import reason: ${id}`)
  return message
}

/** Whole-import failures. All three mean "this is not the file we asked for". */
export const NOT_AN_EXPORT_MESSAGE =
  'This file is not a Liftosaur JSON export. Use Settings → Export data to JSON file.'
export const WRONG_EXPORT_MESSAGE = 'This is the CSV/program-text export; only the JSON export can be imported.'
export const CORRUPT_HISTORY_MESSAGE = 'The export’s history is not a list — the file looks corrupt.'

export interface ImportSkip {
  level: 'record' | 'entry' | 'set'
  /** Human-locatable, e.g. `2026-05-04 A1 / Squat / set 2`. */
  ref: string
  reason: ReasonId
  detail?: string
}

/** Non-fatal observations, aggregated over the whole import. */
export interface ImportNote {
  reason: ReasonId
  count: number
  detail?: string
}

export interface ImportReport {
  imported: number
  skipped: ImportSkip[]
  notes: ImportNote[]
  /** Set only when the whole import failed; `sessions` is then empty. */
  failure?: string
  /** The units the export itself was written in, so an lb -> kg conversion is visible. */
  sourceUnits?: Unit
}

export interface ImportOptions {
  /** The importing user's uid — the export carries no usable identity. */
  uid: string
  /** Target profile units; every weight is converted into them. Defaults to the export's own units. */
  units?: Unit
  /** Opt in to `storage.progress`, the unfinished workouts. Off by default. */
  includeInProgress?: boolean
}

export interface ImportResult {
  sessions: Session[]
  report: ImportReport
}

/** Liftosaur's own dedup heuristic: same workout if the start times are within a minute. */
const DUPLICATE_WINDOW_MS = 60_000

// ---------------------------------------------------------------------------
// Defensive readers. Every access to the untrusted JSON goes through these.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * A Liftosaur `IWeight` is `{ value, unit }` and never a bare number. Three
 * things make this stricter than a cast: `unit` may be `'%'` (an `IPercentage`
 * hiding in `originalWeight`, which must never become a weight), `value` may be
 * `null` on exports older than the `fix_null_entries_set_weights` migration,
 * and either may simply be absent.
 */
function readWeight(value: unknown): Weight | undefined {
  if (!isObject(value)) return undefined
  if (value.unit !== 'kg' && value.unit !== 'lb') return undefined
  const amount = finiteNumber(value.value)
  return amount === undefined ? undefined : makeWeight(amount, value.unit)
}

function toWeightValue(w: Weight, units: Unit): WeightValue {
  const converted = convert(w, units)
  return { value: converted.value, unit: converted.unit }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

class Reporter {
  readonly skipped: ImportSkip[] = []
  private readonly noted = new Map<ReasonId, { count: number; details: Set<string> }>()
  // Notes are buffered per record and kept only if the record survives: a
  // dropped warmup inside a workout we then skip whole is not an observation
  // about the import, it is noise.
  private pending: { reason: ReasonId; detail?: string; count: number }[] = []

  skip(level: ImportSkip['level'], ref: string, reason: ReasonId, detail?: string): void {
    this.skipped.push({ level, ref, reason, ...(detail === undefined ? {} : { detail }) })
  }

  note(reason: ReasonId, detail?: string, count = 1): void {
    this.pending.push({ reason, ...(detail === undefined ? {} : { detail }), count })
  }

  keepNotes(): void {
    for (const { reason, detail, count } of this.pending) {
      const entry = this.noted.get(reason) ?? { count: 0, details: new Set<string>() }
      entry.count += count
      if (detail !== undefined) entry.details.add(detail)
      this.noted.set(reason, entry)
    }
    this.pending = []
  }

  dropNotes(): void {
    this.pending = []
  }

  notes(): ImportNote[] {
    return [...this.noted.entries()].map(([reason, { count, details }]) => ({
      reason,
      count,
      ...(details.size === 0 ? {} : { detail: [...details].sort().join(', ') }),
    }))
  }
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/**
 * Which shapes we accept, and why.
 *
 * 1. **A raw string** — the file's text. Parsed here so a `JSON.parse` throw
 *    becomes a failed report instead of an exception.
 * 2. **The bare `IStorage` object**, i.e. `{ version, settings, history, ... }`.
 *    This is what "Export data to JSON file" writes: `Exporter_toFile` is
 *    handed `JSON.stringify(storage)` with no envelope at all, and Liftosaur's
 *    own importer feeds `JSON.parse(contents)` straight into `Storage_get`.
 * 3. **A wrapper `{ storage: {...} }`** — INFERRED, not observed. The account
 *    sync payload and some community tooling pass the storage under a key, and
 *    accepting it costs one line, so we unwrap `storage` / `data` if the root
 *    has no `history` of its own.
 * 4. **A bare `IHistoryRecord[]`** — INFERRED. Nothing in Liftosaur writes it,
 *    but a user who pasted only the `history` array is a plausible mistake and
 *    the mapper needs nothing else from the file.
 *
 * The one shape we deliberately do NOT sniff is the filename: the two research
 * passes disagreed about its date separator, and the file's content answers the
 * question anyway.
 */
function unwrap(input: unknown): { storage: Json } | { failure: string } {
  if (typeof input === 'string') {
    const text = input.trimStart()
    if (!text.startsWith('{') && !text.startsWith('[')) {
      // The CSV export and the program-text export are the two files a user is
      // most likely to bring by mistake; name them instead of "invalid JSON".
      // The markers are only ever consulted for text that is already NOT JSON:
      // a real export may well carry a `=====` inside a workout note, and no
      // marker may turn a parseable export into a whole-import failure.
      // Both are looked for at the start of any of the first few lines, not
      // only at byte 0: the exact column list of the CSV header is INFERRED,
      // and a leading comment or blank line must not defeat the recognition.
      const head = text.slice(0, 500)
      if (/(^|\n)\s*={5,}/.test(head)) return { failure: WRONG_EXPORT_MESSAGE }
      if (/(^|\n)\s*Workout\s*DateTime\s*,/i.test(head)) return { failure: WRONG_EXPORT_MESSAGE }
      return { failure: NOT_AN_EXPORT_MESSAGE }
    }

    try {
      return unwrap(JSON.parse(text))
    } catch {
      return { failure: NOT_AN_EXPORT_MESSAGE }
    }
  }

  if (Array.isArray(input)) return { storage: { history: input } }
  if (!isObject(input)) return { failure: NOT_AN_EXPORT_MESSAGE }

  if (!('history' in input)) {
    const nested = isObject(input.storage) ? input.storage : isObject(input.data) ? input.data : undefined
    if (nested && 'history' in nested) return { storage: nested }
    return { failure: NOT_AN_EXPORT_MESSAGE }
  }

  if (!Array.isArray(input.history)) return { failure: CORRUPT_HISTORY_MESSAGE }

  return { storage: input }
}

// ---------------------------------------------------------------------------
// Exercise identity
// ---------------------------------------------------------------------------

/**
 * `benchPress` -> `Bench Press`. INFERRED: the built-in slug list is NOT a closed enum in
 * Liftosaur any more (`VExerciseId = v.string()`), so there is no table to look
 * up — de-camelCasing is a heuristic, and a name it fails to produce simply
 * stays unresolved and is reported. Nothing is ever substituted.
 */
function humanizeSlug(slug: string): string {
  return slug
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

interface ResolvedName {
  name: string
  known: boolean
  /** The slug as written in the export, for the report. */
  slug: string
}

function resolveName(exercise: Json, customNames: Map<string, string>): ResolvedName | undefined {
  const id = nonEmptyString(exercise.id)
  if (id === undefined) return undefined

  const equipment = nonEmptyString(exercise.equipment)
  const custom = customNames.get(id)
  const raw = custom ?? humanizeSlug(id)

  let hit = resolveExercise(raw)
  if (!hit && equipment) {
    // DECISION: Liftosaur spells equipment as a suffix (`Bench Press, Barbell`)
    // while the catalog carries some lifts under an equipment PREFIX alias
    // (`Barbell Squat`). Try both spellings before giving up — both are
    // miss-only retries, so neither can shadow a name that already resolved.
    hit = resolveExercise(`${raw}, ${humanizeSlug(equipment)}`) ?? resolveExercise(`${humanizeSlug(equipment)} ${raw}`)
  }

  return hit ? { name: canonicalName(hit.canonical), known: true, slug: id } : { name: raw, known: false, slug: id }
}

/**
 * INFERRED (the format is read from Liftosaur's source, the T-prefix convention
 * is GZCLP's): the tier survives only inside `entry.id`, which Liftosaur builds as
 * `[label, exerciseKey].join('_')` — a T1 barbell squat is `t1_squat_barbell`.
 * There is no `label` field on a history entry, and the March 2026 migration
 * backfilled older entries with no label at all, so a missing tier is expected
 * and common rather than a data error.
 */
function readTier(entry: Json): 1 | 2 | 3 | undefined {
  const id = nonEmptyString(entry.id)
  const match = id ? /^t([123])_/i.exec(id) : null
  return match ? (Number(match[1]) as 1 | 2 | 3) : undefined
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

interface SetContext {
  units: Unit
  ref: string
  reporter: Reporter
  /** Unfinished workouts pre-fill `completedReps` with the prescription, not with results. */
  inProgress: boolean
}

function mapSet(raw: unknown, ctx: SetContext): SetLog | undefined {
  if (!isObject(raw)) {
    ctx.reporter.skip('set', ctx.ref, 'malformed-set')
    return undefined
  }

  // `isCompleted` did not exist before the March 2025 migration; its own
  // backfill rule is `completedReps != null`, so applying it here reads a
  // pre-migration export exactly the way Liftosaur would have migrated it.
  const numeric = finiteNumber(raw.completedReps)
  const present = raw.completedReps !== undefined && raw.completedReps !== null
  const unreadable = present && (numeric === undefined || numeric < 0)
  if (unreadable) ctx.reporter.note('bad-completed-reps')
  const completed = unreadable ? undefined : numeric

  const logged = typeof raw.isCompleted === 'boolean' ? raw.isCompleted : completed !== undefined
  // An unfinished workout pre-fills `completedReps` from the prescription, so
  // only an explicit `isCompleted` proves a set there was actually performed.
  const done = ctx.inProgress ? raw.isCompleted === true : logged

  let prescribedReps = finiteNumber(raw.reps)
  if (prescribedReps === undefined) {
    if (completed === undefined) {
      ctx.reporter.skip('set', ctx.ref, 'no-reps')
      return undefined
    }
    // `reps` is optional in the modern schema even though it was required in
    // 2023; a logged set with only a result still tells us what was done.
    prescribedReps = completed
    ctx.reporter.note('prescribed-reps-defaulted')
  }

  // Weight: what was actually lifted wins over what was prescribed, and
  // `originalWeight` is the last resort because it is the only one of the three
  // that can be a percentage — which is never a weight.
  const resolvedWeight =
    readWeight(raw.completedWeight) ??
    readWeight(raw.weight) ??
    (isWeight(raw.originalWeight) ? readWeight(raw.originalWeight) : undefined)
  if (resolvedWeight === undefined) {
    ctx.reporter.skip('set', ctx.ref, 'no-weight')
    return undefined
  }

  const minReps = finiteNumber(raw.minReps)
  const label = nonEmptyString(raw.label)

  const completedLeft = finiteNumber(raw.completedRepsLeft)
  if (completedLeft !== undefined && completedLeft !== completed) ctx.reporter.note('unilateral-collapsed')

  return {
    prescribedReps,
    ...(minReps !== undefined && minReps < prescribedReps ? { minReps } : {}),
    isAmrap: raw.isAmrap === true,
    // `null` means untouched. A logged `0` is NOT the same thing: Liftosaur
    // writes a deliberately skipped set as completed at zero reps, and losing
    // that would turn a missed AMRAP into a workout that never happened.
    // A rep count we could not read is evidence of nothing, even when the set
    // claims to be complete — `null` says "untouched", never a made-up number.
    completedReps: !done || unreadable ? null : (completed ?? 0),
    weight: toWeightValue(resolvedWeight, ctx.units),
    ...(label === undefined ? {} : { label }),
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

interface MappedExercise {
  name: string
  tier?: 1 | 2 | 3
  sets: SetLog[]
}

/** Orders by the explicit `index` only when every element carries one — never a mix. */
function inDeclaredOrder(items: unknown[]): unknown[] {
  const indexes = items.map((item) => (isObject(item) ? finiteNumber(item.index) : undefined))
  if (indexes.some((index) => index === undefined)) return items
  return items
    .map((item, i) => ({ item, index: indexes[i] as number }))
    .sort((a, b) => a.index - b.index)
    .map((e) => e.item)
}

function mapEntry(
  raw: unknown,
  recordRef: string,
  customNames: Map<string, string>,
  reporter: Reporter,
  units: Unit,
  inProgress: boolean,
): MappedExercise | undefined {
  if (!isObject(raw) || !isObject(raw.exercise)) {
    reporter.skip('entry', recordRef, 'malformed-entry')
    return undefined
  }

  const resolved = resolveName(raw.exercise, customNames)
  if (resolved === undefined) {
    reporter.skip('entry', recordRef, 'malformed-entry')
    return undefined
  }

  const entryRef = `${recordRef} / ${resolved.name}`
  if (!resolved.known) reporter.note('unknown-exercise', resolved.slug)

  if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
    reporter.skip('entry', entryRef, 'no-sets')
    return undefined
  }

  if (Array.isArray(raw.warmupSets) && raw.warmupSets.length > 0) {
    // runbo's `SetLog` has no warmup flag, and importing warmups would corrupt
    // every set-shape match that `deriveState` runs afterwards.
    reporter.note('warmups-dropped', undefined, raw.warmupSets.length)
  }
  if (nonEmptyString(raw.superset) !== undefined) reporter.note('superset-flattened')

  const tier = readTier(raw)
  if (tier === undefined) reporter.note('tier-unrecoverable')

  const ordered = inDeclaredOrder(raw.sets)
  const sets: SetLog[] = []
  for (const [i, rawSet] of ordered.entries()) {
    const set = mapSet(rawSet, { units, ref: `${entryRef} / set ${i + 1}`, reporter, inProgress })
    if (set) sets.push(set)
  }

  if (sets.length === 0) {
    reporter.skip('entry', entryRef, 'all-sets-skipped')
    return undefined
  }

  return { name: resolved.name, ...(tier === undefined ? {} : { tier }), sets }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

interface RecordDates {
  iso: string
  startTime: number
}

/** `toIso` of an epoch-ms instant, or `undefined` when it is outside the Date range. */
function isoAt(ms: number): string | undefined {
  const at = new Date(ms)
  return Number.isNaN(at.getTime()) ? undefined : toIso(at)
}

function readDates(raw: Json): RecordDates | undefined {
  // `startTime` wins over `date`: when a user edits a workout's date Liftosaur
  // writes local midnight rendered through `toISOString()`, which lands on the
  // previous calendar day for anyone east of UTC.
  const startTime = finiteNumber(raw.startTime)
  if (startTime !== undefined) {
    // A finite number is not necessarily a representable instant: the Date range
    // is ±8.64e15 ms, and beyond it `toIso` would emit "0NaN-NaN-NaN" — a string
    // that every later `parseIso` in the app would throw on.
    const iso = isoAt(startTime)
    if (iso !== undefined) return { iso, startTime }
  }

  const date = typeof raw.date === 'string' ? Date.parse(raw.date) : Number.NaN
  if (!Number.isFinite(date)) return undefined
  const iso = isoAt(date)
  if (iso === undefined) return undefined
  return { iso, startTime: date }
}

/**
 * `dayName` is kept verbatim (only case-normalised when it is a GZCLP rotation
 * day) rather than resolved against a program: the mapper has no program, and
 * `deriveState` needs the name as logged to find the day in a custom program.
 * DECISION: an absent day name leaves `programDay` unset and is noted; it never
 * skips the record, because only rotation recovery depends on it.
 */
function readProgramDay(raw: Json, reporter: Reporter): string | undefined {
  const dayName = nonEmptyString(raw.dayName)
  if (dayName === undefined) {
    reporter.note('unmapped-programDay')
    return undefined
  }

  const rotation = GZCLP_ROTATION.find((day) => day.toLowerCase() === dayName.toLowerCase())
  return rotation ?? dayName
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Maps one Liftosaur export into runbo sessions. Never throws: a file it cannot
 * read comes back as `{ sessions: [], report: { failure } }`, and any record,
 * entry or set it cannot read comes back as a skip with a reason.
 */
export function importLiftosaurHistory(input: unknown, options: ImportOptions): ImportResult {
  const unwrapped = unwrap(input)
  if ('failure' in unwrapped) {
    return { sessions: [], report: { imported: 0, skipped: [], notes: [], failure: unwrapped.failure } }
  }

  const storage = unwrapped.storage
  if (!Array.isArray(storage.history)) {
    return { sessions: [], report: { imported: 0, skipped: [], notes: [], failure: CORRUPT_HISTORY_MESSAGE } }
  }

  const settings = isObject(storage.settings) ? storage.settings : {}
  const sourceUnits: Unit | undefined = settings.units === 'kg' || settings.units === 'lb' ? settings.units : undefined
  const units = options.units ?? sourceUnits ?? 'kg'

  // Custom exercises keep their names here even when soft-deleted, so a lift the
  // user removed months ago still resolves to a name rather than to a uuid.
  const customNames = new Map<string, string>()
  if (isObject(settings.exercises)) {
    for (const [id, exercise] of Object.entries(settings.exercises)) {
      const name = isObject(exercise) ? nonEmptyString(exercise.name) : undefined
      if (name !== undefined) customNames.set(id, name)
    }
  }

  const deleted = new Set<number>(
    (Array.isArray(storage.deletedHistory) ? storage.deletedHistory : []).filter(
      (id): id is number => typeof id === 'number',
    ),
  )

  const reporter = new Reporter()
  const sessions: Session[] = []
  const acceptedStartTimes: number[] = []
  const usedIds = new Set<string>()

  const queue: { raw: unknown; inProgress: boolean }[] = storage.history.map((raw) => ({ raw, inProgress: false }))
  // VERIFIED against Liftosaur's schema (`progress: v.array(VHistoryRecord)` in
  // src/types.ts): unfinished workouts are an array of the same record shape as
  // `history`, so they go through the identical mapper. The guard stays because
  // the export is still untrusted input.
  if (options.includeInProgress && Array.isArray(storage.progress)) {
    for (const raw of storage.progress) queue.push({ raw, inProgress: true })
  }

  for (const [position, { raw, inProgress }] of queue.entries()) {
    reporter.dropNotes()

    if (!isObject(raw)) {
      reporter.skip('record', `record #${position + 1}`, 'malformed-record')
      continue
    }

    const dates = readDates(raw)
    const dayName = nonEmptyString(raw.dayName)
    // The ref must locate the record for a human even when its date is the
    // very thing that is missing.
    const ref = `${dates ? dates.iso : `record #${position + 1}`}${dayName ? ` ${dayName}` : ''}`

    if (dates === undefined) {
      reporter.skip('record', ref, 'no-usable-date')
      continue
    }

    // A record sitting in `history` with `id: 0` or a `progress` vtype is an
    // unfinished workout that leaked into the finished list. Whether that can
    // actually happen is UNVERIFIED; guarding costs nothing.
    if (!inProgress && (raw.id === 0 || raw.vtype === 'progress')) {
      reporter.skip('record', ref, 'in-progress')
      continue
    }

    const rawId = finiteNumber(raw.id)
    if (rawId !== undefined && deleted.has(rawId)) {
      reporter.skip('record', ref, 'deleted')
      continue
    }

    if (acceptedStartTimes.some((time) => Math.abs(time - dates.startTime) <= DUPLICATE_WINDOW_MS)) {
      reporter.skip('record', ref, 'duplicate-workout')
      continue
    }

    if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
      reporter.skip('record', ref, 'no-entries')
      continue
    }

    const before = reporter.skipped.length
    const exercises: MappedExercise[] = []
    for (const rawEntry of inDeclaredOrder(raw.entries)) {
      const entry = mapEntry(rawEntry, ref, customNames, reporter, units, inProgress)
      if (entry) exercises.push(entry)
    }

    if (exercises.length === 0) {
      const reasons = reporter.skipped.slice(before).map((skip) => skip.reason)
      reporter.skip('record', ref, 'all-entries-skipped', [...new Set(reasons)].join(', ') || undefined)
      continue
    }

    // DECISION: a workout whose every exercise is a cardio modality is not a
    // runbo strength session, and a runbo cardio session needs minutes and a
    // prescription that a Liftosaur strength log simply does not carry. Skipping
    // is the honest outcome; inventing a cardio session would not be.
    if (exercises.every((exercise) => modalityOf(exercise.name) !== undefined)) {
      reporter.skip('record', ref, 'cardio-only')
      continue
    }

    // Liftosaur ids are `timestamp + random(1000)` and are explicitly not
    // collision-proof, so uniqueness is enforced here rather than assumed.
    let id = `liftosaur-${rawId !== undefined && rawId !== 0 ? rawId : dates.startTime}`
    if (usedIds.has(id)) {
      let suffix = 2
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
      reporter.note('duplicate-id')
    }
    usedIds.add(id)

    const programDay = readProgramDay(raw, reporter)
    const notes = nonEmptyString(raw.notes)
    if (inProgress) reporter.note('in-progress-imported')

    sessions.push({
      id,
      uid: options.uid,
      date: dates.iso,
      kind: 'strength',
      status: inProgress ? 'active' : 'done',
      ...(programDay === undefined ? {} : { programDay }),
      exercises,
      source: 'manual',
      ...(notes === undefined ? {} : { notes }),
      // `externalId` is documented as the Strava activity id; the Liftosaur id
      // is preserved inside `Session.id` instead of overloading that field.
    })
    acceptedStartTimes.push(dates.startTime)
    reporter.keepNotes()
  }

  return {
    sessions,
    report: {
      imported: sessions.length,
      skipped: reporter.skipped,
      notes: reporter.notes(),
      ...(sourceUnits === undefined ? {} : { sourceUnits }),
    },
  }
}

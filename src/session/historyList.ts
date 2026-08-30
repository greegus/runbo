/**
 * The read model behind HistoryView: one line per logged session, grouped by
 * month, plus the single predicate that decides which row may be deleted.
 *
 * Pure — no Vue, no Firestore, no `Date`. That matters most for `isDeletable`:
 * the store's `deleteLastSession` re-queries the server for the newest document
 * and would happily delete something other than the row the athlete tapped, so
 * "is this the newest one?" has to be a rule the view cannot get wrong by
 * comparing array indices against a page that has since moved.
 */

import { format } from '@/liftoscript/weight'
import { sessionTonnage } from '@/training/progressStats'
import type { CardioPrescription, Profile, Session } from '@/types'
import { formatHuman, parseIso } from '@/utils/date'

export interface HistoryEntry {
  session: Session
  /** 'Strength A1' | 'Easy run 40 min' */
  title: string
  /** '5 lifts · 4250 kg' | '8.2 km · RPE 5'; `null` when there is nothing to add. */
  subtitle: string | null
  human: string
  isActive: boolean
  /** Deleting this session restores program state — it carries a `stateSnapshot`. */
  restoresState: boolean
}

export interface HistoryGroup {
  /** '2026-08' */
  key: string
  /** 'August 2026' */
  label: string
  /** Newest first. */
  entries: HistoryEntry[]
}

const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const KIND_WORDS: Record<CardioPrescription['kind'], string> = {
  easy: 'easy',
  intervals: 'interval',
  tempo: 'tempo',
  long: 'long',
}

/** '12 Aug' — the confirmation dialog names a day, and the full `formatHuman` line is too long for a title. */
function shortDay(iso: string): string {
  const date = parseIso(iso)

  return `${date.getUTCDate()} ${MONTH_NAMES_SHORT[date.getUTCMonth()]}`
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`
}

function strengthTitle(session: Session): string {
  return session.programDay ? `Strength ${session.programDay}` : 'Strength session'
}

function cardioTitle(session: Session): string {
  const minutes = session.minutes ?? session.prescription?.targetMinutes ?? null
  const duration = minutes === null ? '' : ` ${minutes} min`

  if (!session.prescription) return `Cardio${duration}`.trim()

  return capitalise(`${KIND_WORDS[session.prescription.kind]} ${session.prescription.modality}${duration}`)
}

function strengthSubtitle(session: Session, profile: Profile): string | null {
  const lifts = session.exercises?.length ?? 0
  if (lifts === 0) return null

  const parts = [`${lifts} ${lifts === 1 ? 'lift' : 'lifts'}`]
  const tonnage = sessionTonnage(session, profile.settings.units)
  if (tonnage.value > 0) parts.push(format(tonnage))

  return parts.join(' · ')
}

function cardioSubtitle(session: Session): string | null {
  const parts: string[] = []

  if (typeof session.distanceKm === 'number') parts.push(`${session.distanceKm} km`)
  if (typeof session.avgHr === 'number') parts.push(`${session.avgHr} bpm`)
  if (typeof session.rpe === 'number') parts.push(`RPE ${session.rpe}`)

  return parts.length === 0 ? null : parts.join(' · ')
}

/** One session as a row: what it was, when, and whether deleting it would move the program. */
export function describeSession(session: Session, profile: Profile): HistoryEntry {
  const isCardio = session.kind === 'cardio'

  return {
    session,
    title: isCardio ? cardioTitle(session) : strengthTitle(session),
    subtitle: isCardio ? cardioSubtitle(session) : strengthSubtitle(session, profile),
    human: formatHuman(session.date),
    isActive: session.status === 'active',
    restoresState: session.stateSnapshot != null,
  }
}

/**
 * Newest first, both between and within groups. The same-day tie is broken on
 * `id` descending, which is exactly the order the server returns: both
 * `listSessionHistory` and `loadLatestSession` order by `date desc` alone, and
 * Firestore appends an implicit `orderBy(__name__)` in the same direction. Do
 * NOT tie-break on `createdAt` — ids are random uuids, so that order disagrees
 * with the server's about half the time, and `isDeletable` would then offer the
 * button on a different session than `deleteLastSession` removes.
 */
function byNewestFirst(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1

    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export function groupByMonth(sessions: Session[], profile: Profile): HistoryGroup[] {
  const groups: HistoryGroup[] = []

  for (const session of byNewestFirst(sessions)) {
    const key = session.date.slice(0, 7)
    const last = groups[groups.length - 1]
    const entry = describeSession(session, profile)

    if (last && last.key === key) {
      last.entries.push(entry)
      continue
    }

    const date = parseIso(session.date)
    groups.push({
      key,
      label: `${MONTH_NAMES_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      entries: [entry],
    })
  }

  return groups
}

/**
 * May this session be deleted? Only the single newest one, by the same total
 * order the list is drawn in.
 *
 * Status is deliberately irrelevant: `loadLatestSession` ignores it, so an
 * `active` session can be the newest document on the server, and offering the
 * button on the second row instead would delete that active one behind the
 * athlete's back.
 */
export function isDeletable(session: Session, sessions: Session[]): boolean {
  const newest = byNewestFirst(sessions)[0]

  return newest !== undefined && newest.id === session.id
}

/**
 * The confirmation. Two variants, because what comes back differs: a strength
 * session carries the program state it was recorded against, a cardio one
 * carries nothing. Promising a restore that will not happen is the worse of the
 * two failures, so the copy is decided from `restoresState`, never from `kind`.
 */
export function deleteConfirmCopy(entry: HistoryEntry): { title: string; content: string; confirmLabel: string } {
  const day = shortDay(entry.session.date)

  if (entry.restoresState) {
    const label = entry.session.programDay ?? 'this session'

    return {
      title: `Delete ${label} of ${day}?`,
      content:
        `This session is removed and your program goes back to the weights it had before it — ` +
        `the working weights, stages and rotation position from ${day}. There is no undo.`,
      confirmLabel: 'Delete and restore',
    }
  }

  return {
    title: `Delete the ${describeForTitle(entry)} of ${day}?`,
    content:
      `This session is removed. Nothing about your program changes — this session did not carry a ` +
      `saved program state. There is no undo.`,
    confirmLabel: 'Delete',
  }
}

/** The noun the dialog title uses — lower-cased, because it sits mid-sentence. */
function describeForTitle(entry: HistoryEntry): string {
  const session = entry.session

  if (session.kind === 'cardio') {
    return session.prescription
      ? `${KIND_WORDS[session.prescription.kind]} ${session.prescription.modality}`
      : 'cardio session'
  }

  return session.programDay ? `${session.programDay} session` : 'session'
}

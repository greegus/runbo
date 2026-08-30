/**
 * The athlete's backup.
 *
 * The spec calls the JSON export "all user data", and it is the only copy of a
 * training history that otherwise lives in one Firestore project — so this
 * module strips NOTHING. `stateSnapshot` stays (it is what makes a session
 * undoable), `programState` stays, `active` sessions stay. A field left out
 * here is a field that cannot be reconstructed later.
 *
 * Pure and clock-free: `exportedOn` is passed in, because a module that reads
 * the clock cannot be tested for the day it names.
 */

import type { BodyweightEntry, Profile, Session } from '@/types'

export interface ExportBundle {
  schema: 'runbo.export.v1'
  /** ISO day, passed in by the caller — never read from a clock in here. */
  exportedOn: string
  profile: Profile
  /** Oldest first; status 'done' and 'active' both. */
  sessions: Session[]
  /** Oldest first. */
  bodyweight: BodyweightEntry[]
  counts: { sessions: number; bodyweightEntries: number; lifts: number }
}

export const EXPORT_SCHEMA = 'runbo.export.v1'

/** Milliseconds of a `createdAt`, or 0 — an undated document sorts first, deterministically. */
function createdAtMs(value: Date | undefined): number {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : 0
}

/**
 * Oldest first, with ties broken all the way down to the id. Two sessions on
 * one day are normal (a lift and a run), so `date` alone is not a total order,
 * and an export whose row order wobbles between runs is one nobody can diff.
 */
function bySessionDate(a: Session, b: Session): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1

  const created = createdAtMs(a.createdAt) - createdAtMs(b.createdAt)
  if (created !== 0) return created

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function byEntryDate(a: BodyweightEntry, b: BodyweightEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The whole export, shaped. The inputs are copied, not sorted in place: the
 * caller's arrays are store snapshots that other screens are still rendering.
 */
export function buildExport(
  profile: Profile,
  sessions: Session[],
  bodyweight: BodyweightEntry[],
  exportedOn: string,
): ExportBundle {
  const orderedSessions = [...sessions].sort(bySessionDate)
  const orderedBodyweight = [...bodyweight].sort(byEntryDate)

  return {
    schema: EXPORT_SCHEMA,
    exportedOn,
    profile,
    sessions: orderedSessions,
    bodyweight: orderedBodyweight,
    counts: {
      sessions: orderedSessions.length,
      bodyweightEntries: orderedBodyweight.length,
      lifts: Object.keys(profile.strengthTrack.programState).length,
    },
  }
}

/** `runbo-export-2026-08-30.json` — the day is in the name so two backups never collide. */
export function exportFileName(exportedOn: string): string {
  return `runbo-export-${exportedOn}.json`
}

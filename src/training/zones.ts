/**
 * Intensity resolution: turns whatever the user configured (HR, pace, or
 * nothing at all) into the concrete numbers a prescription card shows.
 *
 * Everything degrades: a prescription is always describable, because RPE plus a
 * verbal cue needs no configuration. That is the whole point of this module —
 * the planner never has to know whether zones exist.
 */

import type { CardioPrescription, Modality, Profile } from '@/types'

export type Zone = 1 | 2 | 3 | 4 | 5

export const ZONES: Zone[] = [1, 2, 3, 4, 5]

export interface HrZone {
  zone: Zone
  min: number // bpm, inclusive
  max: number // bpm, inclusive
}

/** Unit of a pace zone — one per modality, never mixed. */
export type PaceUnit = 'sec/km' | 'km/h' | 'sec/100m'

export interface PaceZone {
  zone: Zone
  min: number // always the numerically smaller bound
  max: number
  unit: PaceUnit
}

export interface HrConfig {
  max?: number
  lthr?: number
  age?: number // only used when `max` is missing
}

/** A recent effort used as the threshold benchmark, or the threshold value itself. */
export type PaceInput = number | { distanceKm: number; minutes: number }

/**
 * Zone floors as a share of the anchor, plus the top of Z5. Both tables come
 * straight from the plan (Friel's LTHR zones / the classic %maxHR ladder).
 *
 * Only the FLOORS are stored: each zone runs up to the next zone's floor minus
 * one bpm, which keeps the five ranges contiguous — every heartbeat belongs to
 * exactly one zone instead of falling into a rounding gap between two.
 */
const LTHR_FLOORS: Record<Zone, number> = { 1: 0.5, 2: 0.68, 3: 0.84, 4: 0.95, 5: 1.05 }
const LTHR_CEILING = 1.15

const MAX_HR_FLOORS: Record<Zone, number> = { 1: 0.5, 2: 0.6, 3: 0.7, 4: 0.8, 5: 0.9 }
const MAX_HR_CEILING = 1.0

/**
 * Pace percentages are fractions of threshold SPEED, not of a time-per-distance
 * number: 75 % intensity means going slower, i.e. MORE seconds per km. For the
 * time-based units we therefore divide the threshold by the fraction.
 */
const SPEED_PERCENTS: Record<Zone, [number, number]> = {
  1: [0.65, 0.75],
  2: [0.75, 0.84],
  3: [0.85, 0.94],
  4: [0.95, 1.05],
  5: [1.05, 1.15],
}

const PACE_UNITS: Record<Modality, PaceUnit> = {
  run: 'sec/km',
  bike: 'km/h',
  swim: 'sec/100m',
}

/** RPE + words, the always-available fallback. Index = zone. */
const RPE_CUES: Record<Zone, string> = {
  1: 'RPE 2-3 - very easy, recovery',
  2: 'RPE 3-4 - conversational',
  3: 'RPE 5-6 - comfortably hard',
  4: 'RPE 7-8 - hard, short sentences only',
  5: 'RPE 9-10 - all out',
}

const KIND_LABELS: Record<CardioPrescription['kind'], string> = {
  easy: 'easy',
  intervals: 'intervals',
  tempo: 'tempo',
  long: 'long',
}

/** Tanaka's formula — the plan's chosen max-HR estimate. */
export function maxFromAge(age: number): number {
  return 208 - 0.7 * age
}

/**
 * Five bpm ranges, LTHR-based when available (it tracks fitness far better than
 * an age-guessed max). Returns null when nothing is configured.
 */
export function hrZones(hr: HrConfig | undefined): HrZone[] | null {
  if (!hr) return null

  const lthr = hr.lthr !== undefined && hr.lthr > 0 ? hr.lthr : undefined
  const max = hr.max ?? (hr.age !== undefined ? maxFromAge(hr.age) : undefined)
  const anchor = lthr ?? max

  if (anchor === undefined || anchor <= 0) return null

  const floors = lthr ? LTHR_FLOORS : MAX_HR_FLOORS
  const ceiling = lthr ? LTHR_CEILING : MAX_HR_CEILING

  return ZONES.map((zone) => {
    const min = Math.round(anchor * floors[zone])
    const nextFloor = zone < 5 ? Math.round(anchor * floors[(zone + 1) as Zone]) : Math.round(anchor * ceiling) + 1

    return { zone, min, max: Math.max(min, nextFloor - 1) }
  })
}

/** Threshold value in the modality's unit, from a benchmark effort or a stored number. */
export function thresholdPace(modality: Modality, recent: PaceInput | undefined): number | null {
  if (recent === undefined) return null

  if (typeof recent === 'number') {
    return recent > 0 ? recent : null
  }

  const { distanceKm, minutes } = recent

  if (!(distanceKm > 0) || !(minutes > 0)) return null

  if (modality === 'bike') return distanceKm / (minutes / 60)
  if (modality === 'swim') return (minutes * 60) / (distanceKm * 10) // per 100 m
  return (minutes * 60) / distanceKm
}

/**
 * Five pace ranges around the threshold. The recent performance is taken AS the
 * threshold effort — no Riegel-style distance correction in the MVP.
 */
export function paceZones(modality: Modality, recent: PaceInput | undefined): PaceZone[] | null {
  const threshold = thresholdPace(modality, recent)

  if (threshold === null) return null

  const unit = PACE_UNITS[modality]
  const isSpeed = unit === 'km/h'

  return ZONES.map((zone) => {
    const [low, high] = SPEED_PERCENTS[zone]
    // Speed scales with the fraction; time per distance is its inverse.
    const a = isSpeed ? threshold * low : threshold / low
    const b = isSpeed ? threshold * high : threshold / high

    return {
      zone,
      min: roundPace(Math.min(a, b), isSpeed),
      max: roundPace(Math.max(a, b), isSpeed),
      unit,
    }
  })
}

function roundPace(value: number, isSpeed: boolean): number {
  return isSpeed ? Math.round(value * 10) / 10 : Math.round(value)
}

function formatClock(seconds: number): string {
  const whole = Math.round(seconds)

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** '5:40-6:10 /km' | '28-31.5 km/h' | '1:45-2:00 /100m' */
export function formatPaceZone(zone: PaceZone): string {
  if (zone.unit === 'km/h') return `${zone.min}-${zone.max} km/h`

  const suffix = zone.unit === 'sec/km' ? '/km' : '/100m'

  return `${formatClock(zone.min)}-${formatClock(zone.max)} ${suffix}`
}

export function formatHrZone(zone: HrZone): string {
  return `${zone.min}-${zone.max} bpm`
}

function describeStructure(structure: NonNullable<CardioPrescription['structure']>): string {
  return `${structure.reps}x${structure.workMinutes}min work / ${structure.restMinutes}min rest`
}

/**
 * The one-line string the UI shows, e.g.
 * '40 min easy - 128-145 bpm - 5:40-6:10 /km'.
 *
 * HR and pace segments appear only when configured; when NEITHER is, the RPE cue
 * takes their place so the line is never just a duration.
 */
export function describePrescription(
  prescription: CardioPrescription,
  zones: Profile['cardioTrack']['zones'] | undefined,
): string {
  const zone = prescription.zone as Zone
  const parts = [`${prescription.targetMinutes} min ${KIND_LABELS[prescription.kind]}`]

  if (prescription.structure) {
    parts.push(describeStructure(prescription.structure))
  }

  const hr = hrZones(zones?.hr)?.[zone - 1]
  const pace = paceZones(prescription.modality, zones?.pace?.[prescription.modality])?.[zone - 1]

  if (hr) parts.push(formatHrZone(hr))
  if (pace) parts.push(formatPaceZone(pace))
  if (!hr && !pace) parts.push(RPE_CUES[zone])

  return parts.join(' - ')
}

/** Exposed so views can show the cue alongside numbers when they want to. */
export function rpeCue(zone: Zone): string {
  return RPE_CUES[zone]
}

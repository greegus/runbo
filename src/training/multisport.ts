/**
 * Multisport card usage: how many entries a month used, and whether the card
 * paid for itself.
 *
 * An entry is a finished strength session (the gym), a finished swim (the
 * pool) or a claimed sauna, unless the athlete marked it as not paid with the
 * card. At most one entry a day: a sauna after a gym session is the same visit
 * on the same card swipe, and it must not count twice.
 */

import type { Profile, Session } from '@/types'

export type MultisportCard = NonNullable<Profile['settings']['multisport']>

export const DEFAULT_MULTISPORT: MultisportCard = { monthlyPrice: 1150, entryPrice: 150 }

/**
 * A finished visit of the kind the card pays for — the gym, the pool, the
 * sauna — whether or not it was paid with it. A run or a ride outside is free
 * anyway.
 */
export function isMultisportKind(session: Session): boolean {
  if (session.status !== 'done') return false
  if (session.kind === 'strength' || session.kind === 'sauna') return true

  return session.kind === 'cardio' && session.prescription?.modality === 'swim'
}

/** A visit that counts as a card entry: the right kind, and not marked off the card. */
export function isMultisportVisit(session: Session): boolean {
  return isMultisportKind(session) && session.multisport !== false
}

export interface MultisportMonth {
  /** 'YYYY-MM'. */
  month: string
  /** The days the card was used, in date order. */
  days: string[]
  entries: number
  /** What those entries would have cost one by one. */
  value: number
  /** The entry that makes the card pay: the first whose total covers the price. */
  breakEvenEntries: number
  /** Entries still needed to break even; 0 once it has. */
  remaining: number
  /** `value - monthlyPrice`: negative until the card pays, the saving after. */
  balance: number
}

export function multisportMonth(sessions: Session[], month: string, card: MultisportCard): MultisportMonth {
  const days = [
    ...new Set(sessions.filter((s) => s.date.startsWith(`${month}-`) && isMultisportVisit(s)).map((s) => s.date)),
  ].sort()
  const entries = days.length
  const value = entries * card.entryPrice
  const breakEvenEntries = card.entryPrice > 0 ? Math.ceil(card.monthlyPrice / card.entryPrice) : 0

  return {
    month,
    days,
    entries,
    value,
    breakEvenEntries,
    remaining: Math.max(0, breakEvenEntries - entries),
    balance: value - card.monthlyPrice,
  }
}

/** 'YYYY-MM' of an ISO day. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** The month `delta` months away from 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  const total = year * 12 + (index - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

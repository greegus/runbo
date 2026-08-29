/**
 * The plate-inventory rules the gym form needs — kept out of the `.vue` file so
 * they can be unit tested (the vitest project is node-environment and cannot
 * compile a component).
 *
 * Nothing here does weight maths: `smallestStep` / `platesFor` in
 * `liftoscript/weight.ts` own that, and a second implementation is how the
 * prescribed weights and the plate hint start to disagree.
 */

export interface PlateRow {
  weight: number // in the profile's units
  count: number // pairs owned, i.e. how many are available PER SIDE
}

export interface PlateInventoryError {
  /** Row the message belongs to; `-1` when it is about the inventory as a whole. */
  index: number
  message: string
}

/** Per side, in kg — the same inventory `createDefaultProfile` writes. */
const DEFAULT_KG_PLATES: PlateRow[] = [
  { weight: 25, count: 2 },
  { weight: 20, count: 2 },
  { weight: 15, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
  { weight: 1.25, count: 2 },
]

/** Per side, in lb — a standard commercial-gym rack. */
const DEFAULT_LB_PLATES: PlateRow[] = [
  { weight: 45, count: 2 },
  { weight: 35, count: 2 },
  { weight: 25, count: 2 },
  { weight: 10, count: 2 },
  { weight: 5, count: 2 },
  { weight: 2.5, count: 2 },
]

/** The inventory offered when the user asks for a fresh set in that unit. */
export function defaultPlateRows(units: 'kg' | 'lb'): PlateRow[] {
  return (units === 'lb' ? DEFAULT_LB_PLATES : DEFAULT_KG_PLATES).map((row) => ({ ...row }))
}

/**
 * Heaviest first, without merging or dropping anything — what the form applies
 * when a weight field loses focus. Sorting on every keystroke would move the row
 * out from under the thumb mid-edit; sorting on blur keeps the list in the order
 * `platesFor` reasons about without fighting the user.
 */
export function sortPlatesDesc(rows: PlateRow[]): PlateRow[] {
  return [...rows].sort((a, b) => b.weight - a.weight)
}

/**
 * The inventory as the domain layer should see it: unusable rows dropped,
 * duplicates collapsed onto the larger count, heaviest first. The form emits raw
 * rows (so a half-typed one stays on screen) and only normalises when it hands
 * the settings on, which is why validation and normalisation are separate.
 */
export function normalizePlates(rows: PlateRow[]): PlateRow[] {
  const byWeight = new Map<number, number>()

  for (const row of rows) {
    if (!Number.isFinite(row.weight) || row.weight <= 0) continue
    if (!Number.isFinite(row.count) || row.count <= 0) continue

    const count = Math.floor(row.count)
    byWeight.set(row.weight, Math.max(byWeight.get(row.weight) ?? 0, count))
  }

  return [...byWeight.entries()].map(([weight, count]) => ({ weight, count })).sort((a, b) => b.weight - a.weight)
}

/**
 * Every problem the user has to fix, one message per offending row. A duplicate
 * is reported on the *second* occurrence so the first row the user typed stays
 * unblamed.
 */
export function validatePlates(rows: PlateRow[]): PlateInventoryError[] {
  const errors: PlateInventoryError[] = []
  const seen = new Set<number>()

  rows.forEach((row, index) => {
    if (!Number.isFinite(row.weight) || row.weight <= 0) {
      errors.push({ index, message: 'Enter a plate weight greater than 0.' })
    } else if (seen.has(row.weight)) {
      errors.push({ index, message: 'You already have this plate size.' })
    } else {
      seen.add(row.weight)
    }

    if (!Number.isFinite(row.count) || row.count < 1 || !Number.isInteger(row.count)) {
      errors.push({ index, message: 'Enter how many pairs you own — a whole number, at least 1.' })
    }
  })

  if (normalizePlates(rows).length === 0) {
    errors.push({ index: -1, message: 'Add at least one plate size — the app cannot load a bar without plates.' })
  }

  return errors
}

/** `null` when the barbell weight is usable. */
export function validateBarbell(weight: number): string | null {
  if (!Number.isFinite(weight) || weight <= 0) return 'Enter the weight of your bar — a number greater than 0.'
  return null
}

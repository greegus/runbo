import type { PlateColor } from '@/types'

/**
 * How each plate colour is painted, shared by the disc on a set and the swatch
 * in the plate settings, so the colour picked is the colour shown.
 *
 * Every paint has a rim a shade darker than its fill — the edge a real plate
 * has. It keeps a pale disc a disc on a white screen and a red one a disc on a
 * logged set's orange row. Painted plates get white digits; the pastel change
 * plates and chrome get dark ink, since white on a pastel fails contrast under
 * gym lighting. Green is the 700 because white on green-600 is about 3:1.
 */
export const PLATE_PAINT: Record<PlateColor, { fill: string; ink: string; rim: string }> = {
  red: { fill: 'bg-red-600', ink: 'text-white', rim: 'ring-red-700' },
  blue: { fill: 'bg-blue-600', ink: 'text-white', rim: 'ring-blue-700' },
  yellow: { fill: 'bg-yellow-400', ink: 'text-ink-900', rim: 'ring-yellow-500' },
  green: { fill: 'bg-green-700', ink: 'text-white', rim: 'ring-green-800' },
  grey: { fill: 'bg-ink-500', ink: 'text-white', rim: 'ring-ink-600' },
  'pale-red': { fill: 'bg-red-200', ink: 'text-red-900', rim: 'ring-red-300' },
  'pale-blue': { fill: 'bg-blue-200', ink: 'text-blue-900', rim: 'ring-blue-300' },
  'pale-yellow': { fill: 'bg-yellow-100', ink: 'text-yellow-900', rim: 'ring-yellow-300' },
  'pale-green': { fill: 'bg-green-200', ink: 'text-green-900', rim: 'ring-green-300' },
  'pale-grey': { fill: 'bg-ink-100', ink: 'text-ink-800', rim: 'ring-ink-300' },
  silver: { fill: 'bg-ink-300', ink: 'text-ink-900', rim: 'ring-ink-400' },
  black: { fill: 'bg-ink-800', ink: 'text-white', rim: 'ring-ink-900' },
}

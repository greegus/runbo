import { describe, expect, it } from 'vitest'

import { buildLineChart } from '../lineChart'
import type { LineChartInput, LineSeriesInput } from '../types'

function series(
  id: string,
  points: LineSeriesInput['points'],
  overrides: Partial<LineSeriesInput> = {},
): LineSeriesInput {
  return { id, label: id, role: 'emphasis', shape: 'line', points, ...overrides }
}

function input(all: LineSeriesInput[], overrides: Partial<LineChartInput> = {}): LineChartInput {
  return {
    series: all,
    yUnit: 'kg',
    formatValue: (value) => String(value),
    formatDate: (iso) => iso.slice(5),
    emptyMessage: 'Nothing yet.',
    ...overrides,
  }
}

/** Every value the chart drew has to survive into the table. */
function drawnValues(layout: ReturnType<typeof buildLineChart>): number {
  return layout.series.reduce((total, s) => total + s.markers.length, 0)
}

function tableValues(layout: ReturnType<typeof buildLineChart>): number {
  return layout.table.rows.reduce((total, row) => total + row.slice(1).filter((cell) => cell !== '—').length, 0)
}

describe('buildLineChart', () => {
  it('reports empty and invents no axes when there is nothing to draw', () => {
    const layout = buildLineChart(input([series('a', []), series('b', [null, null])]))

    expect(layout.isEmpty).toBe(true)
    expect(layout.yTicks).toEqual([])
    expect(layout.xTicks).toEqual([])
    expect(layout.series).toEqual([])
    expect(layout.table.rows).toEqual([])
    expect(layout.summary).toBe('Nothing yet.')
  })

  it('draws one point as a labelled marker with no path and a real y-domain', () => {
    const layout = buildLineChart(input([series('a', [{ date: '2026-08-01', value: 100 }])]))

    expect(layout.isEmpty).toBe(false)
    expect(layout.series[0].path).toBe('')
    expect(layout.series[0].markers).toHaveLength(1)
    expect(layout.series[0].end).not.toBeNull()
    expect(layout.yTicks.length).toBeGreaterThan(0)
    expect(layout.series[0].markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))).toBe(true)
  })

  it('draws a flat line at the vertical middle when every value is identical', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 80 },
          { date: '2026-08-08', value: 80 },
          { date: '2026-08-15', value: 80 },
        ]),
      ]),
    )

    const ys = layout.series[0].markers.map((m) => m.y)
    expect(new Set(ys).size).toBe(1)
    expect(ys[0]).toBeCloseTo((layout.frame.yRange[0] + layout.frame.yRange[1]) / 2, 6)
    expect(layout.yTicks.length).toBeGreaterThan(0)
  })

  it('breaks the path across a gap but keeps both dates in the table', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-01-05', value: 88 },
          { date: '2026-01-12', value: 90 },
          null,
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-08', value: 102.5 },
        ]),
      ]),
    )

    expect(layout.series[0].path.match(/M /g)).toHaveLength(2)
    expect(layout.table.rows.map((row) => row[0])).toEqual(['01-05', '01-12', '08-01', '08-08'])
  })

  it('still marks a point that is alone between two breaks, even though no line reaches it', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-01-05', value: 90 },
          null,
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-08', value: 102.5 },
        ]),
      ]),
    )

    expect(layout.series[0].path.match(/M /g)).toHaveLength(1)
    expect(layout.series[0].markers).toHaveLength(3)
    expect(layout.table.rows).toHaveLength(3)
  })

  it('flags the lone point as isolated so the renderer draws a dot the line cannot', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-01-05', value: 90 },
          null,
          { date: '2026-02-10', value: 100 },
          { date: '2026-02-12', value: 101 },
          { date: '2026-02-14', value: 102.5 },
        ]),
      ]),
    )

    expect(layout.series[0].markers.map((marker) => marker.isolated)).toEqual([true, false, false, false])
  })

  it('never loses a drawn value from the numbers table', () => {
    const fixtures: LineChartInput[] = [
      input([series('a', [{ date: '2026-08-01', value: 100 }])]),
      input([
        series('a', [
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-08', value: 105 },
        ]),
        series('b', [{ date: '2026-08-08', value: 130 }], { role: 'context', shape: 'dots' }),
      ]),
      input([series('a', [{ date: '2026-01-01', value: 0 }, null, { date: '2026-08-01', value: 60 }])]),
    ]

    for (const fixture of fixtures) {
      const layout = buildLineChart(fixture)
      expect(tableValues(layout)).toBe(drawnValues(layout))
    }
  })

  it('renders a zero as 0 and an absent value as an em dash', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 0 },
          { date: '2026-08-08', value: 10 },
        ]),
        series('b', [{ date: '2026-08-08', value: 20 }], { role: 'context' }),
      ]),
    )

    expect(layout.table.rows[0]).toEqual(['08-01', '0', '—'])
    expect(layout.table.rows[1]).toEqual(['08-08', '10', '20'])
  })

  it('names the span, the last value and the delta in the summary', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-15', value: 112.5 },
        ]),
      ]),
    )

    expect(layout.summary).toContain('08-01')
    expect(layout.summary).toContain('08-15')
    expect(layout.summary).toContain('112.5')
    expect(layout.summary).toContain('up 12.5')
  })

  it('labels the peak only when it is not already the endpoint', () => {
    const rising = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-08', value: 110 },
        ]),
      ]),
    )
    expect(rising.series[0].peak).toBeNull()

    const fallen = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 120 },
          { date: '2026-08-08', value: 100 },
        ]),
      ]),
    )
    expect(fallen.series[0].peak).not.toBeNull()
  })

  it('gives a dots series no path and never scrolls', () => {
    const layout = buildLineChart(
      input([
        series(
          'raw',
          [
            { date: '2026-08-01', value: 80 },
            { date: '2026-08-02', value: 81 },
          ],
          { shape: 'dots' },
        ),
      ]),
    )

    expect(layout.series[0].path).toBe('')
    expect(layout.series[0].markers).toHaveLength(2)
    expect(layout.scrolls).toBe(false)
  })

  it('emits a legend only when there are two or more keys', () => {
    const one = buildLineChart(input([series('a', [{ date: '2026-08-01', value: 1 }])]))
    expect(one.legend).toEqual([])

    const two = buildLineChart(
      input([
        series('a', [{ date: '2026-08-01', value: 1 }]),
        series('b', [{ date: '2026-08-01', value: 2 }], { role: 'context' }),
      ]),
    )
    expect(two.legend).toHaveLength(2)
  })

  it('never overprints x labels when the dates cluster then jump', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-01-01', value: 100 },
          { date: '2026-01-02', value: 101 },
          { date: '2026-01-03', value: 102 },
          { date: '2026-08-01', value: 110 },
        ]),
      ]),
    )

    const xs = layout.xTicks.map((tick) => tick.x)
    expect(xs.every((value, index) => index === 0 || value - xs[index - 1] >= 34)).toBe(true)
    expect(layout.xTicks[layout.xTicks.length - 1].date).toBe('2026-08-01')
    // Every dropped date is still readable in the numbers table.
    expect(layout.table.rows).toHaveLength(4)
  })

  it('spaces the x axis by real time, so a layoff reads as a layoff', () => {
    const layout = buildLineChart(
      input([
        series('a', [
          { date: '2026-08-01', value: 100 },
          { date: '2026-08-08', value: 101 },
          { date: '2026-08-29', value: 102 },
        ]),
      ]),
    )

    const [a, b, c] = layout.series[0].markers.map((m) => m.x)
    expect((c - b) / (b - a)).toBeCloseTo(3, 1)
  })
})

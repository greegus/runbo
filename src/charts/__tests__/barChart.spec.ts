import { describe, expect, it } from 'vitest'

import { buildBarChart } from '../barChart'
import { CHART_WIDTH } from '../geometry'
import type { BarChartInput } from '../types'

function input(bars: BarChartInput['bars'], overrides: Partial<BarChartInput> = {}): BarChartInput {
  return {
    bars,
    formatValue: (value) => String(value),
    referenceLabel: 'target',
    emptyMessage: 'No cardio logged.',
    ...overrides,
  }
}

function bar(key: string, value: number | null, reference: number | null = 150) {
  return { key, label: key, value, reference }
}

describe('buildBarChart', () => {
  it('reports empty and invents no axes with no bars at all', () => {
    const layout = buildBarChart(input([]))

    expect(layout.isEmpty).toBe(true)
    expect(layout.yTicks).toEqual([])
    expect(layout.bars).toEqual([])
    expect(layout.reference).toBeNull()
    expect(layout.table.rows).toEqual([])
  })

  it('reports empty when every bar is null, even with a target', () => {
    const layout = buildBarChart(input([bar('w1', null), bar('w2', null)]))

    expect(layout.isEmpty).toBe(true)
    expect(layout.reference).toBeNull()
  })

  it('keeps a zero week and a missing week distinct, in the marks and in the table', () => {
    const layout = buildBarChart(input([bar('w1', 0), bar('w2', null), bar('w3', 120)]))

    expect(layout.bars[0]).toMatchObject({ isZero: true, missing: false, height: 0, path: '' })
    expect(layout.bars[1]).toMatchObject({ isZero: false, missing: true, height: 0, path: '' })
    expect(layout.bars[2].height).toBeGreaterThan(0)
    expect(layout.bars[2].path).not.toBe('')

    expect(layout.table.rows[0][1]).toBe('0')
    expect(layout.table.rows[1][1]).toBe('—')
  })

  it('never loses a bar from the numbers table', () => {
    const fixtures = [
      input([bar('w1', 120)]),
      input([bar('w1', 0), bar('w2', null), bar('w3', 120)]),
      input(Array.from({ length: 12 }, (_, i) => bar(`w${i}`, i * 10))),
    ]

    for (const fixture of fixtures) {
      const layout = buildBarChart(fixture)
      expect(layout.table.rows).toHaveLength(fixture.bars.length)
      expect(layout.bars).toHaveLength(fixture.bars.length)
    }
  })

  it('draws a target that sits above every bar without clipping it off the plot', () => {
    const layout = buildBarChart(input([bar('w1', 20, 300), bar('w2', 30, 300)]))

    expect(layout.reference).not.toBeNull()
    expect(layout.reference?.labelY).toBeGreaterThanOrEqual(layout.frame.yRange[1])
    expect(layout.reference?.labelY).toBeLessThanOrEqual(layout.frame.yRange[0])
  })

  it('draws a target that sits below every bar', () => {
    const layout = buildBarChart(input([bar('w1', 400, 60), bar('w2', 500, 60)]))

    expect(layout.reference?.labelY).toBeLessThanOrEqual(layout.frame.yRange[0])
    // The bars are still taller than the rule, which is the whole point.
    expect(layout.bars[0].y).toBeLessThan(layout.reference?.labelY ?? 0)
  })

  it('steps the target where it changes and merges it where it does not', () => {
    const layout = buildBarChart(input([bar('w1', 10, 150), bar('w2', 10, 150), bar('w3', 10, 120)]))

    expect(layout.reference?.path.match(/M /g)).toHaveLength(1)
    expect(layout.reference?.label).toBe('target 120')
  })

  it('scrolls only once the bands outgrow the viewport', () => {
    expect(buildBarChart(input([bar('w1', 10), bar('w2', 20)])).scrolls).toBe(false)

    const wide = buildBarChart(input(Array.from({ length: 26 }, (_, i) => bar(`w${i}`, i))))
    expect(wide.frame.width).toBeGreaterThan(CHART_WIDTH)
    expect(wide.scrolls).toBe(true)
  })

  it('labels only the last real bar and a readable subset of the axis', () => {
    const layout = buildBarChart(input([...Array.from({ length: 11 }, (_, i) => bar(`w${i}`, 10)), bar('w11', null)]))

    expect(layout.bars.filter((b) => b.endLabel !== null).map((b) => b.key)).toEqual(['w10'])
    expect(layout.bars.filter((b) => b.showLabel).length).toBeLessThanOrEqual(6)
  })

  it('names the span, the last value and the delta in the summary', () => {
    const layout = buildBarChart(input([bar('w1', 100), bar('w2', 130)]))

    expect(layout.summary).toContain('w1')
    expect(layout.summary).toContain('w2')
    expect(layout.summary).toContain('130')
    expect(layout.summary).toContain('up 30')
  })

  it('emits a two-key legend only when a target exists', () => {
    expect(buildBarChart(input([bar('w1', 10, null)])).legend).toEqual([])
    expect(buildBarChart(input([bar('w1', 10, 150)])).legend).toHaveLength(2)
  })

  it('handles values spanning orders of magnitude', () => {
    const layout = buildBarChart(input([bar('w1', 1, null), bar('w2', 5000, null)]))

    expect(layout.bars.every((b) => Number.isFinite(b.height) && b.height >= 0)).toBe(true)
    expect(layout.bars[0].height).toBeGreaterThanOrEqual(0)
    expect(layout.yTicks.every((tick) => Number.isFinite(tick.y))).toBe(true)
  })
})

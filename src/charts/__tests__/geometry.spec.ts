import { describe, expect, it } from 'vitest'

import {
  bandFrame,
  bandScale,
  barRects,
  CHART_WIDTH,
  clamp,
  dayScale,
  extent,
  frame,
  linePath,
  linearScale,
  niceTicks,
  paddedExtent,
  pickLabelIndices,
  roundTo,
  roundedBarPath,
  stepPath,
} from '../geometry'

describe('frame', () => {
  it('never goes narrower than CHART_WIDTH and inverts the y range', () => {
    const f = frame({ width: 100 })

    expect(f.width).toBe(CHART_WIDTH)
    expect(f.yRange[0]).toBeGreaterThan(f.yRange[1])
    expect(f.viewBox).toBe(`0 0 ${f.width} ${f.height}`)
  })

  it('grows with the band count so the bar chart scrolls instead of squashing', () => {
    const narrow = bandFrame(4)
    const wide = bandFrame(26)

    expect(narrow.width).toBe(CHART_WIDTH)
    expect(wide.width).toBeGreaterThan(CHART_WIDTH)
  })
})

describe('extent', () => {
  it('returns null for an empty list', () => {
    expect(extent([])).toBeNull()
  })

  it('ignores non-finite values instead of propagating them', () => {
    expect(extent([Number.NaN, 3, Number.POSITIVE_INFINITY, 9])).toEqual({ min: 3, max: 9 })
    expect(extent([Number.NaN])).toBeNull()
  })
})

describe('paddedExtent', () => {
  it('falls back to a unit span with no data', () => {
    expect(paddedExtent([])).toEqual({ min: 0, max: 1 })
  })

  it('opens a symmetric span when every value is identical', () => {
    const domain = paddedExtent([80, 80, 80])

    expect(domain.max - domain.min).toBeGreaterThan(0)
    expect((domain.min + domain.max) / 2).toBeCloseTo(80, 6)
  })

  it('keeps a real zero at the bottom when includeZero is set', () => {
    const domain = paddedExtent([0, 0], { includeZero: true })

    expect(domain.min).toBe(0)
    expect(domain.max).toBeGreaterThan(0)
  })

  it('keeps negatives', () => {
    const domain = paddedExtent([-2, 5])

    expect(domain.min).toBeLessThan(-2)
    expect(domain.max).toBeGreaterThan(5)
  })

  it('spans orders of magnitude without collapsing the small end', () => {
    const domain = paddedExtent([0.5, 5000], { includeZero: true })

    expect(domain.min).toBe(0)
    expect(domain.max).toBeGreaterThan(5000)
  })
})

describe('linearScale', () => {
  it('maps every input to the midpoint of the range on a zero-span domain', () => {
    const scale = linearScale({ min: 5, max: 5 }, [0, 100])

    expect(scale(5)).toBe(50)
    expect(scale(-1000)).toBe(50)
    expect(scale(1000)).toBe(50)
  })

  it('never returns NaN or Infinity', () => {
    const domains = [
      { min: 0, max: 0 },
      { min: 5, max: 5 },
      { min: -10, max: 10 },
      { min: 0.001, max: 1e6 },
    ]

    for (const domain of domains) {
      const scale = linearScale(domain, [0, 180])
      for (const value of [0, -1e9, 1e9, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
        expect(Number.isFinite(scale(value))).toBe(true)
      }
    }
  })
})

describe('niceTicks', () => {
  it('returns clean values inside the domain', () => {
    const ticks = niceTicks({ min: 0, max: 97 })

    expect(ticks.length).toBeGreaterThan(1)
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(0)
      expect(tick).toBeLessThanOrEqual(97)
    }
    // A constant step of a 1 / 2 / 2.5 / 5 × 10^k family.
    const step = roundTo(ticks[1] - ticks[0], 6)
    for (let i = 1; i < ticks.length; i++) {
      expect(roundTo(ticks[i] - ticks[i - 1], 6)).toBe(step)
    }
  })

  it('returns a single tick for a zero-span domain instead of looping', () => {
    expect(niceTicks({ min: 42, max: 42 })).toEqual([42])
  })

  it('starts the first tick INSIDE an off-step domain, never below it', () => {
    // The shape `paddedExtent` actually produces for a bodyweight axis. A tick
    // below `min` scales past the bottom of the frame and draws its grid line
    // and label under the x axis, on top of the dates.
    const domain = { min: 79.2, max: 84 }
    const ticks = niceTicks(domain)

    expect(ticks[0]).toBeGreaterThanOrEqual(domain.min)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(domain.max)
  })
})

describe('dayScale', () => {
  it('is linear in real time, not in index', () => {
    const scale = dayScale(['2026-08-01', '2026-08-08', '2026-08-29'], [0, 300])

    const a = scale.x('2026-08-01')
    const b = scale.x('2026-08-08')
    const c = scale.x('2026-08-29')

    expect(a).toBe(0)
    expect(c).toBe(300)
    // 7 days then 21 days: the second leg is three times the first.
    expect((c - b) / (b - a)).toBeCloseTo(3, 6)
    expect(scale.spanDays).toBe(28)
  })

  it('puts an empty or single-date series at the midpoint', () => {
    const empty = dayScale([], [0, 300])
    expect(empty.x('2026-08-01')).toBe(150)
    expect(empty.first).toBeNull()

    const single = dayScale(['2026-08-01'], [0, 300])
    expect(single.x('2026-08-01')).toBe(150)
    expect(single.spanDays).toBe(0)
  })

  it('throws loudly on a malformed ISO day', () => {
    expect(() => dayScale(['not-a-day'], [0, 300])).toThrow()
  })
})

describe('linePath', () => {
  it('draws nothing for zero or one point', () => {
    expect(linePath([])).toBe('')
    expect(linePath([{ x: 1, y: 2 }])).toBe('')
  })

  it('starts a new sub-path after a break', () => {
    const path = linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 5, y: 5 }, { x: 6, y: 6 }])

    expect(path.match(/M /g)).toHaveLength(2)
  })

  it('collapses consecutive nulls and drops a run of one', () => {
    expect(linePath([null, null, { x: 1, y: 1 }, { x: 2, y: 2 }]).match(/M /g)).toHaveLength(1)
    expect(linePath([{ x: 1, y: 1 }, null, { x: 9, y: 9 }])).toBe('')
  })

  it('rounds coordinates to two decimals so the string is assertable', () => {
    expect(
      linePath([
        { x: 1.23456, y: 2.98765 },
        { x: 3, y: 4 },
      ]),
    ).toBe('M 1.23 2.99 L 3 4')
  })
})

describe('barRects', () => {
  const band = bandScale(3, [0, 300])
  const y = linearScale({ min: 0, max: 100 }, [180, 0])

  it('keeps a zero and a missing value distinguishable', () => {
    const rects = barRects([0, null, 30], y, band)

    expect(rects[0].isZero).toBe(true)
    expect(rects[0].missing).toBe(false)
    expect(rects[0].height).toBe(0)

    expect(rects[1].missing).toBe(true)
    expect(rects[1].isZero).toBe(false)
    expect(rects[1].height).toBe(0)

    expect(rects[2].height).toBeGreaterThan(0)
  })

  it('treats a negative value as a real value, not as a zero', () => {
    const signed = linearScale({ min: -50, max: 100 }, [180, 0])
    const rects = barRects([-20], signed, band)

    expect(rects[0].isZero).toBe(false)
    expect(rects[0].missing).toBe(false)
    expect(rects[0].height).toBeGreaterThan(0)
    // It hangs BELOW the baseline; `y` is the top of the drawn rect either way.
    expect(rects[0].y).toBe(signed(0))
  })
})

describe('roundedBarPath', () => {
  it('clamps the radius on a one-unit bar and never emits a negative arc', () => {
    const path = roundedBarPath({ x: 0, y: 179, width: 20, height: 1 }, 4)

    expect(path.startsWith('M ')).toBe(true)
    expect(path).not.toMatch(/-\d/)
  })

  it('draws nothing at height zero', () => {
    expect(roundedBarPath({ x: 0, y: 180, width: 20, height: 0 })).toBe('')
  })
})

describe('bandScale', () => {
  it('survives a count of zero', () => {
    const band = bandScale(0, [0, 300])

    expect(band.bandWidth).toBe(0)
    expect(Number.isFinite(band.center(0))).toBe(true)
  })
})

describe('stepPath', () => {
  const band = bandScale(3, [0, 300])
  const y = linearScale({ min: 0, max: 200 }, [180, 0])

  it('merges equal consecutive values into one run', () => {
    const path = stepPath([150, 150, 120], y, band)

    expect(path.match(/M /g)).toHaveLength(1)
    // Two runs: the 150 stretch and the 120 stretch.
    expect(path.match(/L /g)).toHaveLength(3)
  })

  it('breaks the path across a missing period', () => {
    expect(stepPath([150, null, 150], y, band).match(/M /g)).toHaveLength(2)
  })

  it('draws nothing when no period carries a target', () => {
    expect(stepPath([null, null, null], y, band)).toBe('')
    expect(stepPath([], y, band)).toBe('')
  })
})

describe('pickLabelIndices', () => {
  it('handles the degenerate counts', () => {
    expect(pickLabelIndices(0, 5)).toEqual([])
    expect(pickLabelIndices(1, 5)).toEqual([0])
  })

  it('returns unique ascending indices spanning the series', () => {
    const picked = pickLabelIndices(52, 5)

    expect(picked[0]).toBe(0)
    expect(picked[picked.length - 1]).toBe(51)
    expect(picked.length).toBeLessThanOrEqual(5)
    expect(new Set(picked).size).toBe(picked.length)
    expect([...picked].sort((a, b) => a - b)).toEqual(picked)
  })
})

describe('what geometry deliberately does not do', () => {
  // Pinned so nobody later drops a sort or a de-duplication into a function
  // called once per point. The adapters own that, once, before the hot path.
  it('does not sort its input', () => {
    const scale = dayScale(['2026-08-29', '2026-08-01'], [0, 300])

    expect(scale.first).toBe('2026-08-29')
    expect(scale.spanDays).toBe(-28)
  })

  it('does not de-duplicate dates', () => {
    const scale = dayScale(['2026-08-01', '2026-08-01'], [0, 300])

    expect(scale.spanDays).toBe(0)
    expect(scale.x('2026-08-01')).toBe(150)
  })

  it('does not drop a non-finite value from a path', () => {
    expect(
      linePath([
        { x: Number.NaN, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toContain('NaN')
  })
})

describe('clamp and roundTo', () => {
  it('clamps and rounds', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
    expect(roundTo(1.23456)).toBe(1.23)
    expect(roundTo(1.23456, 4)).toBe(1.2346)
  })
})

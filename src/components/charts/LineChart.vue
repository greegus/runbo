<script setup lang="ts">
import type { LineChartLayout } from '@/charts/types'
import ChartFigure from '@/components/charts/ChartFigure.vue'

/**
 * Renders a `LineChartLayout`. There is no arithmetic in this file — no
 * `Math.*`, no multiplying template expression, no computed that does anything
 * but read the prop. Every number below came out of `buildLineChart`, which is
 * the only half of a chart this repo can actually test.
 *
 * Offsets are static `dx`/`dy` attributes for the same reason: a constant is
 * not a calculation, and it keeps label nudging out of the builder.
 */
const props = withDefaults(
  defineProps<{
    chartId: string
    title: string
    layout: LineChartLayout
    subtitle?: string
  }>(),
  { subtitle: '' },
)
</script>

<template>
  <ChartFigure
    :chart-id="props.chartId"
    :title="props.title"
    :subtitle="props.subtitle"
    :layout="props.layout"
    :legend="props.layout.legend"
  >
    <g aria-hidden="true">
      <!-- Grid hairlines are solid. Dashing means "threshold" and is spent on
           the reference line in the bar chart; a dashed grid spends it on
           nothing. -->
      <line
        v-for="tick in props.layout.yTicks"
        :key="`grid-${tick.value}`"
        :x1="props.layout.frame.xRange[0]"
        :x2="props.layout.frame.xRange[1]"
        :y1="tick.y"
        :y2="tick.y"
        stroke="var(--chart-grid)"
        stroke-width="1"
      />

      <line
        :x1="props.layout.frame.xRange[0]"
        :x2="props.layout.frame.xRange[1]"
        :y1="props.layout.frame.yRange[0]"
        :y2="props.layout.frame.yRange[0]"
        stroke="var(--chart-axis)"
        stroke-width="1"
      />

      <text
        v-for="tick in props.layout.yTicks"
        :key="`ylabel-${tick.value}`"
        :x="props.layout.frame.xRange[0]"
        :y="tick.y"
        dx="-6"
        dy="4"
        text-anchor="end"
        font-size="11"
        fill="var(--chart-label)"
      >
        {{ tick.label }}
      </text>

      <text
        v-for="tick in props.layout.xTicks"
        :key="`xlabel-${tick.date}`"
        :x="tick.x"
        :y="props.layout.frame.yRange[0]"
        dy="16"
        text-anchor="middle"
        font-size="11"
        fill="var(--chart-label)"
      >
        {{ tick.label }}
      </text>
    </g>

    <g v-for="series in props.layout.series" :key="series.id" aria-hidden="true">
      <path
        v-if="series.path"
        :d="series.path"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :stroke="series.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
      />

      <!-- Dots for the noisy raw series and for the quiet derived one; the
           emphasis line stays clean and is direct-labelled at its end. An
           `isolated` marker is drawn whatever the shape: no path reaches it, so
           without the dot the session would render as nothing at all. -->
      <g>
        <template v-for="marker in series.markers" :key="`${series.id}-${marker.date}`">
          <circle
            v-if="series.shape === 'dots' || series.role === 'context' || marker.isolated"
            :cx="marker.x"
            :cy="marker.y"
            r="3"
            :fill="series.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
            stroke="var(--chart-surface)"
            stroke-width="2"
          />
        </template>
      </g>

      <circle
        v-if="series.end"
        :cx="series.end.x"
        :cy="series.end.y"
        r="4"
        :fill="series.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
        stroke="var(--chart-surface)"
        stroke-width="2"
      />

      <!-- Direct labels are the endpoint and the extreme only, and they are
           ink, not the series colour: coloured text is the first thing to fail
           at 4.5:1. -->
      <text
        v-if="series.end"
        :x="series.end.x"
        :y="series.end.y"
        dx="7"
        dy="4"
        font-size="12"
        font-weight="600"
        fill="var(--chart-ink)"
      >
        {{ series.end.label }}
      </text>

      <text
        v-if="series.peak"
        :x="series.peak.x"
        :y="series.peak.y"
        dy="-9"
        text-anchor="middle"
        font-size="11"
        fill="var(--chart-label)"
      >
        {{ series.peak.label }}
      </text>
    </g>
  </ChartFigure>
</template>

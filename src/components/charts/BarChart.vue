<script setup lang="ts">
import type { BarChartLayout } from '@/charts/types'
import ChartFigure from '@/components/charts/ChartFigure.vue'

/**
 * Renders a `BarChartLayout`. Same rule as `LineChart.vue`: no arithmetic in
 * this file, every coordinate comes from `buildBarChart`.
 */
const props = withDefaults(
  defineProps<{
    chartId: string
    title: string
    layout: BarChartLayout
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
    </g>

    <g v-for="bar in props.layout.bars" :key="bar.key" aria-hidden="true">
      <path v-if="bar.path" :d="bar.path" fill="var(--chart-emphasis)" />

      <!-- A logged zero gets a stub on the baseline; a week with nothing to
           report gets nothing at all. "No cardio that week" and "that week has
           not happened yet" are different facts and must not look the same. -->
      <rect v-else-if="bar.isZero" :x="bar.x" :y="bar.y" :width="bar.width" height="2" fill="var(--chart-stub)" />

      <text
        v-if="bar.showLabel"
        :x="bar.labelX"
        :y="props.layout.frame.yRange[0]"
        dy="16"
        text-anchor="middle"
        font-size="11"
        fill="var(--chart-label)"
      >
        {{ bar.label }}
      </text>

      <text
        v-if="bar.endLabel"
        :x="bar.labelX"
        :y="bar.y"
        dy="-6"
        text-anchor="middle"
        font-size="12"
        font-weight="600"
        fill="var(--chart-ink)"
      >
        {{ bar.endLabel }}
      </text>
    </g>

    <!-- The target is a threshold, so it is the one dashed thing on the plot,
         and it steps: a target that changed week to week has to be drawn as
         having changed. -->
    <g v-if="props.layout.reference" aria-hidden="true">
      <path
        :d="props.layout.reference.path"
        fill="none"
        stroke="var(--chart-reference)"
        stroke-width="1.5"
        stroke-dasharray="4 2"
      />
      <text
        :x="props.layout.reference.labelX"
        :y="props.layout.reference.labelY"
        dx="4"
        dy="-4"
        text-anchor="end"
        font-size="11"
        fill="var(--chart-label)"
      >
        {{ props.layout.reference.label }}
      </text>
    </g>
  </ChartFigure>
</template>

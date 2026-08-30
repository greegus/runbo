<script setup lang="ts">
import type { ChartFrameLayout, LegendKey } from '@/charts/types'

/**
 * The frame every chart sits in: the caption, the legend, the scroll container,
 * the `role="img"` wiring and the "Show numbers" table.
 *
 * All of it lives here so the three charts cannot drift apart on accessibility
 * — there is no component test harness in this app, and a `<desc>` that only
 * one of three charts remembered to render is exactly the kind of omission
 * nothing would catch.
 */
const props = withDefaults(
  defineProps<{
    chartId: string
    title: string
    layout: ChartFrameLayout
    subtitle?: string
    legend?: LegendKey[]
    height?: number
  }>(),
  { subtitle: '', legend: () => [], height: 180 },
)
</script>

<template>
  <figure class="chart flex flex-col rounded-lg border border-ink-200 bg-white p-4">
    <figcaption class="flex flex-col gap-0.5">
      <h3 class="text-sm font-semibold text-ink-900">{{ props.title }}</h3>
      <p v-if="props.subtitle" class="text-xs text-ink-500">{{ props.subtitle }}</p>
    </figcaption>

    <!-- A frame with axes and no data is a lie about having data, so an empty
         chart renders the sentence and nothing else. -->
    <p v-if="props.layout.isEmpty" class="mt-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-500">
      {{ props.layout.emptyMessage }}
    </p>

    <template v-else>
      <!-- Legend only for two or more keys: one key is a label, not a legend.
           The text never wears the series colour — the swatch carries it. -->
      <ul v-if="props.legend.length > 1" class="mt-2 flex flex-wrap gap-4 text-xs text-ink-500">
        <li v-for="key in props.legend" :key="key.id" class="flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true" class="shrink-0 overflow-visible">
            <line
              v-if="key.shape === 'line'"
              x1="0"
              y1="5"
              x2="16"
              y2="5"
              stroke-width="2"
              stroke-linecap="round"
              :stroke="key.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
            />
            <line
              v-else-if="key.shape === 'reference'"
              x1="0"
              y1="5"
              x2="16"
              y2="5"
              stroke-width="1.5"
              stroke-dasharray="4 2"
              stroke="var(--chart-reference)"
            />
            <rect
              v-else-if="key.shape === 'bar'"
              x="4"
              y="0"
              width="8"
              height="10"
              rx="2"
              :fill="key.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
            />
            <circle
              v-else
              cx="8"
              cy="5"
              r="3"
              :fill="key.role === 'emphasis' ? 'var(--chart-emphasis)' : 'var(--chart-context)'"
            />
          </svg>
          {{ key.label }}
        </li>
      </ul>

      <!-- Wide content scrolls HERE. The page itself must never scroll
           sideways, and `overscroll-x-contain` keeps a swipe on the chart from
           dragging the whole screen with it. -->
      <!-- A scroller with no focusable child is unreachable by keyboard, so the
           widest chart would hide its most recent weeks from anyone not using a
           finger. `tabindex` only when it actually scrolls: a tab stop that
           scrolls nowhere is noise. -->
      <div
        class="-mx-4 mt-2 overflow-x-auto overscroll-x-contain px-4 focus-visible:outline-2 focus-visible:outline-accent-600"
        :tabindex="props.layout.scrolls ? 0 : undefined"
        :role="props.layout.scrolls ? 'group' : undefined"
        :aria-label="props.layout.scrolls ? `${props.title} chart, scrollable` : undefined"
      >
        <svg
          role="img"
          :aria-labelledby="`${props.chartId}-title`"
          :aria-describedby="`${props.chartId}-desc`"
          :viewBox="props.layout.frame.viewBox"
          :style="{
            height: `${props.height}px`,
            width: props.layout.scrolls ? `${props.layout.frame.width}px` : undefined,
          }"
          class="chart__svg block min-w-full"
        >
          <!-- The title NAMES the image and the summary DESCRIBES it. Folding
               the summary into `aria-labelledby` makes a whole sentence the
               accessible name, which a rotor listing truncates — cutting off
               the delta, which is the one fact the summary exists to deliver. -->
          <title :id="`${props.chartId}-title`">{{ props.title }}</title>
          <desc :id="`${props.chartId}-desc`">{{ props.layout.summary }}</desc>
          <slot />
        </svg>
      </div>
    </template>

    <details v-if="props.layout.table.rows.length > 0" class="mt-2">
      <!-- Visible on demand rather than `sr-only`: in a gym the exact numbers
           are useful to everyone, and this table is the reason no value is
           gated behind a hover the app cannot offer on touch. -->
      <summary class="flex min-h-[48px] cursor-pointer items-center text-xs font-medium text-ink-600">
        Show numbers
      </summary>

      <div class="overflow-x-auto">
        <table class="mt-2 w-full text-left text-xs tabular-nums">
          <caption class="sr-only">
            {{
              `${props.title} — every value in the chart`
            }}
          </caption>
          <thead>
            <tr>
              <th
                v-for="column in props.layout.table.columns"
                :key="column"
                scope="col"
                class="border-b border-ink-200 py-1 pr-3 font-medium text-ink-500"
              >
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in props.layout.table.rows" :key="index">
              <td
                v-for="(cell, cellIndex) in row"
                :key="cellIndex"
                class="border-b border-ink-100 py-1 pr-3 text-ink-800"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </figure>
</template>

<style scoped>
/**
 * The whole chart palette, in one place, in the house tokens only. Light mode
 * only on purpose: vuiii's dark blocks are never activated in this app, and a
 * dark palette here would be the first violation.
 *
 * `--chart-context` is a neutral rather than a second hue. That is the
 * emphasis form: one series is the point and the rest are context. Giving it a
 * colour would turn three emphasis charts into three categorical charts and
 * lose the story.
 */
.chart {
  --chart-emphasis: var(--color-accent-600);
  --chart-context: var(--color-ink-700);
  --chart-reference: var(--color-ink-400);
  --chart-axis: var(--color-ink-200);
  --chart-grid: var(--color-ink-100);
  --chart-label: var(--color-ink-500);
  --chart-ink: var(--color-ink-900);
  --chart-stub: var(--color-ink-300);
  --chart-surface: #ffffff;
}

/* Reduce is the default state, not the override: the reveal only exists for
   people who did not ask for less motion. */
@media (prefers-reduced-motion: no-preference) {
  .chart__svg :deep(path),
  .chart__svg :deep(circle) {
    transition: opacity 200ms ease-out;
  }
}
</style>

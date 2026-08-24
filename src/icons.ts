import {
  mdiAlertCircleOutline,
  mdiBike,
  mdiCalendarMonthOutline,
  mdiChartLine,
  mdiCheck,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiClose,
  mdiCogOutline,
  mdiDumbbell,
  mdiGoogle,
  mdiHistory,
  mdiHomeOutline,
  mdiMinus,
  mdiPlus,
  mdiRun,
  mdiScaleBathroom,
  mdiSwim,
  mdiTimerOutline,
  mdiWeightKilogram,
} from '@mdi/js'
import { h } from 'vue'
import { registerCustomIconResolver } from 'vuiii'

/**
 * Material Design Icons (pictogrammers.com/library/mdi) wired into the vuiii
 * Icon component: `<Icon name="run" />` and Button prefixIcon/suffixIcon
 * resolve through this map. Only listed icons end up in the bundle.
 */
const MDI_PATHS: Record<string, string> = {
  'alert': mdiAlertCircleOutline,
  'bike': mdiBike,
  'calendar': mdiCalendarMonthOutline,
  'chart': mdiChartLine,
  'check': mdiCheck,
  'chevron-down': mdiChevronDown,
  'chevron-left': mdiChevronLeft,
  'chevron-right': mdiChevronRight,
  'chevron-up': mdiChevronUp,
  'close': mdiClose,
  'cog': mdiCogOutline,
  'dumbbell': mdiDumbbell,
  'google': mdiGoogle,
  'history': mdiHistory,
  'home': mdiHomeOutline,
  'minus': mdiMinus,
  'plus': mdiPlus,
  'run': mdiRun,
  'scale': mdiScaleBathroom,
  'swim': mdiSwim,
  'timer': mdiTimerOutline,
  'weight': mdiWeightKilogram,
}

export function registerMdiIcons() {
  registerCustomIconResolver((name) => {
    const path = MDI_PATHS[name]
    if (!path) return undefined
    return () =>
      h('svg', { viewBox: '0 0 24 24', fill: 'currentColor', width: '1em', height: '1em', 'aria-hidden': 'true' }, [
        h('path', { d: path }),
      ])
  })
}

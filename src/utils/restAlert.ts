/**
 * "Your rest is over", for a phone lying on the bench face down.
 *
 * A short double buzz and a quiet two-note chime. DOM- and device-only, so like
 * `download.ts` it carries no spec — but it does carry two constraints that are
 * easy to get wrong:
 *
 * 1. **Audio needs a gesture.** Mobile browsers create an `AudioContext` in the
 *    `suspended` state and only let a gesture resume it, so `primeRestAlert()`
 *    must be called SYNCHRONOUSLY from the tap that starts the rest — by the
 *    time the clock runs out there is no gesture left to borrow. iOS wants more
 *    than a `resume()`: the context has to have actually rendered something
 *    inside that gesture, hence the inaudible blip on the first prime.
 * 2. **Everything here is allowed to do nothing.** iOS Safari has no Vibration
 *    API at all; Chrome ignores `vibrate()` unless the page is visible, which
 *    means a rest that ends with the screen off is silent-and-still (waking a
 *    locked phone needs a notification, not this). Every call is wrapped and
 *    every failure swallowed: no alert is ever worth an exception thrown from a
 *    timer tick.
 */

/** ms, alternating buzz/pause. Two short pulses read as a signal; one reads as a stray notification. */
const PATTERN = [60, 70, 60]

/** A rising fifth, high enough to cut through a gym and short enough not to be an alarm. */
const NOTES = [
  { hz: 880, at: 0, dur: 0.1 },
  { hz: 1318.5, at: 0.12, dur: 0.16 },
]

/** Deliberately low: this competes with headphones, not with the room. */
const PEAK_GAIN = 0.12

type AudioContextCtor = typeof AudioContext

let ctx: AudioContext | null = null
let unsupported = false
let primed = false

function audioContext(): AudioContext | null {
  if (unsupported) return null
  if (ctx) return ctx

  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext

  if (!Ctor) {
    unsupported = true
    return null
  }

  try {
    ctx = new Ctor()
  } catch {
    unsupported = true
  }

  return ctx
}

/**
 * Call from the tap that starts a rest, never later. Cheap and idempotent, so
 * calling it on every logged set is fine.
 */
export function primeRestAlert(): void {
  const audio = audioContext()
  if (!audio) return

  if (audio.state === 'suspended') void audio.resume().catch(() => {})

  if (primed) return
  primed = true

  // Zero gain, ten milliseconds: the point is that the graph has rendered
  // during a gesture, not that anyone hears it.
  try {
    const osc = audio.createOscillator()
    const gain = audio.createGain()

    gain.gain.value = 0
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.01)
  } catch {
    // An unlock that fails just means the chime may not play. Not fatal.
  }
}

function vibrate(): void {
  if (typeof navigator.vibrate !== 'function') return

  try {
    navigator.vibrate(PATTERN)
  } catch {
    // Some browsers throw instead of returning false when the page is hidden.
  }
}

function chime(): void {
  const audio = audioContext()
  if (!audio) return

  // The context can be suspended again by the OS while the athlete rests; ask
  // for it back, and accept that without a gesture the ask may be refused.
  if (audio.state === 'suspended') void audio.resume().catch(() => {})

  // A hair in the future, because a note scheduled at exactly `currentTime`
  // starts mid-render and clicks.
  const start = audio.currentTime + 0.02

  for (const note of NOTES) {
    try {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      const at = start + note.at

      osc.type = 'sine'
      osc.frequency.value = note.hz

      // Ramped, not switched: an oscillator turned on at full amplitude is a
      // click first and a note second — the opposite of subtle.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.dur)

      osc.connect(gain).connect(audio.destination)
      osc.start(at)
      osc.stop(at + note.dur + 0.02)
    } catch {
      // Skip this note rather than abandoning the one after it.
    }
  }
}

/** The alert itself. Safe to call anywhere; does nothing it cannot do. */
export function playRestAlert(): void {
  vibrate()
  chime()
}

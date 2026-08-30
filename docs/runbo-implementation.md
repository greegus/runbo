# runbo — Implementation Specification

**Version 2.0 | August 2026**

Supersedes *RunPlan Pro — Implementation Specification v1.0* (January 2026; preserved in git history at commit
`e07ef1a`). This document is the in-repo form of the implementation brief that merged RunPlan Pro with the
GZCLP + cardio plan. Together with `runbo-requirements.md` it is the **single source of truth**: where
the code and this document disagree, fix one of them in the same change.

Phases 0–3 are implemented (see *Phases & status* at the end); module signatures below are taken from the code.

---

## Table of contents

1. [Rules for the implementer](#rules-for-the-implementer)
2. [Environment & stack](#environment--stack)
3. [Repository layout](#repository-layout)
4. [Data model](#data-model)
5. [Firestore](#firestore)
6. [Liftoscript engine](#liftoscript-engine)
7. [Built-in GZCLP program](#built-in-gzclp-program)
8. [Training domain](#training-domain)
9. [Firebase client layer](#firebase-client-layer)
10. [Import](#import)
11. [Onboarding wizard](#onboarding-wizard)
12. [Views & components](#views--components)
13. [Cloud Functions](#cloud-functions)
14. [PWA & offline](#pwa--offline)
15. [Error handling](#error-handling)
16. [Testing strategy](#testing-strategy)
17. [Deployment & operations](#deployment--operations)
18. [Accessibility](#accessibility)
19. [Phases & status](#phases--status)

---

## Rules for the implementer

1. Work **phase by phase, in order**. Do not start a phase before the previous phase's acceptance criteria
   pass. Run the phase's verification commands and report their real output.
2. Every decision needed is in this document or the PRD. If something is genuinely not specified, pick the
   simplest option consistent with both and leave a `// DECISION:` comment — do not redesign.
3. Copy patterns from the named source projects (`~/Projects/pubquiz`, `~/Projects/zollstock`) instead of
   inventing new ones (see *Copy-from map*).
4. All domain logic lives in pure TS modules (`src/liftoscript/`, `src/training/`, `src/import/`) with vitest
   tests. Vue components contain **no business rules** — they call the pure modules.
5. UI text is **English**. Code comments match the density and style of the copied sources: sparse, explain
   *why*.
6. Do not add dependencies beyond the ones listed. No chart libraries, no date libraries (small helpers live
   in `src/utils/date.ts`), no CSS frameworks beyond Tailwind 4 + vuiii.
7. Never call `Date.now()` / `new Date()` inside pure domain modules — dates are passed in as ISO `YYYY-MM-DD`
   strings. This keeps every module deterministic and testable.
8. Weights are never raw numbers in domain code — always the `WeightValue` / `Weight` type (value + unit).
9. Liftoscript set arrays are **1-indexed** (`completedReps[1]` is the first set). The interpreter implements
   this; internal TS arrays stay 0-indexed — convert only at the script boundary.

---

## Environment & stack

- Location: `~/Projects/runbo`, GitHub repo `greegus/runbo`, branch `master`. A push to `master` deploys
  (`.github/workflows/deploy.yml`); `npm run deploy` still deploys by hand.
- Vue 3.5 (Composition API, `<script setup lang="ts">`), TypeScript 6, Vite 8, Tailwind 4 (`@tailwindcss/vite`),
  Pinia 4, vue-router 5, vitest 4, oxlint / oxfmt.
- Runtime deps: `firebase`, `vuiii` (beta), `@mdi/js`, `uuid`. Dev: `vite-plugin-pwa`.
- Firebase project on the **Blaze plan**: Google sign-in, Firestore, Functions (nodejs24), Hosting, FCM.
  Client config via `VITE_APP_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID`, `…_MEASUREMENT_ID` in `.env.local` (commit `.env.example` with empty values).
- Emulators: when `import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR`, call `connectAuthEmulator` /
  `connectFirestoreEmulator` with the ports from `firebase.json` (copy the emulators block from
  `~/Projects/pubquiz/firebase.json`).

```sh
npm run dev          # dev server
npm run test         # vitest
npm run type-check   # vue-tsc
npm run build        # type-check + build
npm run lint         # oxlint --fix
npm run format       # oxfmt
npm run deploy       # (Phase 4+) vite build + firebase deploy
```

### Copy-from map (do not reinvent)

| What | Copy / adapt from |
| --- | --- |
| Firebase init (`src/services/firebaseApp.ts`) | `~/Projects/pubquiz/src/services/firebaseApp.ts` |
| Generic Firestore helpers (`src/services/firebaseService.ts`) | `~/Projects/pubquiz/src/services/firebaseService.ts` — keep auth helpers, load/list/save/delete, subscribe*; drop storage/fingerprint parts |
| Typed collections + convertor (`src/constants/firebaseCollections.ts`) | `~/Projects/pubquiz/src/constants/firebaseCollections.ts` — `createConvertor<T>()`; `initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` |
| Per-entity service shape | `~/Projects/pubquiz/src/services/teamsService.ts` |
| Pinia localStorage persist plugin | `~/Projects/zollstock/src/stores/persist.ts` — prefix `runbo:`; UI prefs only, user data lives in Firestore |
| `style.css` structure | `~/Projects/zollstock/src/style.css` — but **light mode only** |
| Icons (`src/icons.ts`) | `~/Projects/zollstock/src/icons.ts` — `registerCustomIconResolver` + `@mdi/js` |
| Functions layout | `~/Projects/pubquiz/functions/` — nodejs24, lint + build predeploy |
| Firestore rules helper style | `~/Projects/pubquiz/firestore.rules` |

---

## Repository layout

```
docs/                       this spec + PRD
public/manifest.webmanifest
src/
  App.vue  main.ts  style.css  icons.ts  types.ts
  router/index.ts           routes below; auth guard added in Phase 4
  components/               AppNav (bottom, 5 tabs) + shared components (Phase 7–8)
  views/                    thin views; one file per route
  liftoscript/              tokenizer, parser, types, weight, evaluator, builtins, progressions, serialize, diagnostics
  training/                 gzclp, cardioPlan, composer, schedule, stats, plates, comeback, readiness, zones, exercises
  utils/date.ts             ISO-date helpers
  services/  constants/  stores/   (Phase 4)
  import/                   (Phase 5)
functions/                  (Phase 10)
```

Routes: `/signin` (hideNav), `/onboarding/:step` (hideNav), `/` Today, `/plan`, `/progress`, `/history`,
`/program`, `/settings`. Session screens (Strength / Cardio) get their route in Phase 7.

---

## Data model

`src/types.ts` is authoritative; this is a readable copy. Dates are ISO `YYYY-MM-DD` strings everywhere.

```ts
type LiftId = string                          // exercise name as written in the program, e.g. 'Squat'
type Modality = 'run' | 'bike' | 'swim'
type SessionKind = 'strength' | 'cardio'
type GoalType = 'open' | 'race' | 'numeric'   // MVP uses only 'open'
interface WeightValue { value: number; unit: 'kg' | 'lb' }

interface Profile {                           // doc: profiles/{uid}
  id: string                                  // == uid
  email: string
  settings: {
    units: 'kg' | 'lb'
    barbellWeight: number                     // in units, default 20
    plates: { weight: number; count: number }[]   // per side; kg default 25×2 20×2 15×2 10×2 5×2 2.5×2 1.25×2
    restTimers: { t1: number; t2: number; t3: number }  // seconds, defaults 180 / 120 / 60
    comebackGapDays: number                   // default 10
    notifications: { daily: boolean; gapNudge: boolean }
    fcmTokens: string[]
  }
  availability: {
    daysPerWeek: number                       // default 5
    preferredDays: number[]                   // 0 = Mon … 6 = Sun, default [0, 1, 2, 4, 5]
    longSessionDay: number                    // default 5 (Sat)
    strengthDaysPerWeek?: number              // how many of `daysPerWeek` go to lifting; default 3, optional
                                              // so a profile written before the field keeps today's split
  }
  strengthTrack: {
    goal: { type: GoalType }
    programText: string                       // Liftoscript source
    programState: Record<string, ExerciseState>   // key = exerciseKey(), e.g. 'T1:Squat'
    rotationCursor: number                    // index into program days, 0-based
  }
  cardioTrack: {
    goal: { type: GoalType }
    modalities: Modality[]
    weeklyMinutes: number                     // current mesocycle baseline
    longestSessionMinutes: number
    mesoWeek: number                          // 1..4
    blockStartDate?: string | null            // Monday the CURRENT training block opened on; null = no block yet.
                                              // NOT a calendar week — the block advances only when it was trained
                                              // in. Optional: absent means a profile written before the field, and
                                              // `cardioBlock.ts` derives it from the legacy `mesoStartDate`
    holdStreak: number                        // consecutive blocks under 70 % of target
    rotationCursor: number                    // index into enabled modalities
    lastPlannedMinutes: number                // what the LAST block prescribed — the adaptive ratio divides by
                                              // this, not by the baseline, so a completed deload is not a "miss"
    zones?: {
      hr?: { max?: number; lthr?: number }
      pace?: { run?: number; bike?: number; swim?: number }   // sec/km, km/h, sec/100 m
    }
  }
  onboarding: { completed: boolean; step: number }
  createdAt?: Date; updatedAt?: Date
}

interface ExerciseState {
  weights: WeightValue[]                      // per set variation; usually length 1
  setVariationIndex: number                   // 1-based, like Liftoscript
  state: Record<string, number | WeightValue> // custom-progression state vars
  askWeight?: boolean                         // true until the first weight is entered
}

interface SetLog {
  prescribedReps: number; minReps?: number; isAmrap: boolean
  completedReps: number | null                // null = untouched / skipped
  weight: WeightValue; label?: string
}

interface Session {                           // doc: sessions/{id}
  id: string; uid: string; date: string; kind: SessionKind; status: 'active' | 'done'
  readiness?: { sleep: number; energy: number; soreness: number }
  // strength
  programDay?: string                         // 'A1'
  exercises?: { name: LiftId; tier?: 1 | 2 | 3; sets: SetLog[] }[]
  progressionSummary?: string[]               // 'Squat: 5×3+ → 6×2+, weight held at 100 kg'
  stateSnapshot?: Record<string, ExerciseState>   // programState BEFORE this session → delete-last-and-restore
  // cardio
  prescription?: CardioPrescription
  source?: 'manual' | 'strava'
  externalId?: string                         // Strava activity id, for dedup
  minutes?: number; distanceKm?: number; avgHr?: number; rpe?: number; notes?: string
  createdAt?: Date; updatedAt?: Date
}

interface CardioPrescription {
  modality: Modality
  kind: 'easy' | 'intervals' | 'tempo' | 'long'
  targetMinutes: number
  structure?: { reps: number; workMinutes: number; restMinutes: number }   // intervals only
  zone: 1 | 2 | 3 | 4 | 5
}

interface BodyweightEntry { id: string; uid: string; date: string; weight: number }   // bodyweight/{id}

interface ComposedWeek { weekStart: string; days: { date: string; planned: PlannedItem | null }[] }  // computed
type PlannedItem =
  | { kind: 'strength'; programDay: string }
  | { kind: 'cardio'; prescription: CardioPrescription }
```

Not in `types.ts` (Functions-only): `stravaAccounts/{uid}` `{ athleteId, accessToken, refreshToken,
expiresAt, scope, connectedAt }`; `config/allowlist` `{ emails: string[] }`. Phase 10 adds
`profiles/{uid}.nextPlanned` (a short text the client writes on every recompose, read by the daily function).

---

## Firestore

Collections: `profiles`, `sessions`, `bodyweight`, `stravaAccounts` (Functions-only), `config` (allowlist).
All documents carry `uid` except `profiles` (doc id == uid) and `config`.

### Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuth() { return request.auth != null; }
    function allowlist() { return get(/databases/$(database)/documents/config/allowlist).data.emails; }
    function isAllowlisted() { return isAuth() && request.auth.token.email in allowlist(); }
    function owns(uid) { return request.auth.uid == uid; }

    match /config/{doc}          { allow read: if isAuth(); allow write: if false; }
    match /profiles/{uid}        { allow read, write: if isAllowlisted() && owns(uid); }
    match /sessions/{id}         { allow read, update, delete: if isAllowlisted() && owns(resource.data.uid);
                                   allow create: if isAllowlisted() && owns(request.resource.data.uid); }
    match /bodyweight/{id}       { /* same as sessions */ }
    match /stravaAccounts/{uid}  { allow read, write: if false; }
  }
}
```

`config` is readable by any signed-in user so SignInView can distinguish "not allowlisted" from "not signed
in". Allowlist is edited in the Firebase console; initially `["matus.duchon@gmail.com"]`.

### Indexes (`firestore.indexes.json`)

- `sessions`: `uid ASC, date DESC` (history, "this week", last-session lookup).
- `bodyweight`: `uid ASC, date DESC`.
- `sessions`: `uid ASC, externalId ASC` if the webhook dedup query needs it (Functions use the Admin SDK, so
  add it when the emulator asks for it).

---

## Liftoscript engine

Reference: https://www.liftosaur.com/doc/liftoscript. We implement the subset below; everything else must
produce a **diagnostic** `{ line, col, message, sourceLine, severity }` — never silent misbehavior.

### Grammar (supported subset)

```
program      := (weekHeader | dayHeader | exerciseLine | comment | blank)*
weekHeader   := '#' text
dayHeader    := '##' text
comment      := '//' text          // shown as description for the next exercise
             |  '///' text         // internal, ignored
exerciseLine := [label ':'] name [',' equipment] ('/' segment)+   // '\' at EOL continues the line
segment      := setSpec | section
setSpec      := setGroup (',' setGroup)*        // consecutive setSpec segments = SET VARIATIONS (1-based)
setGroup     := INT 'x' reps [weight] [rpe] [timer] [setLabel]
reps         := INT ['-' INT] ['+']             // range; '+' = AMRAP
weight       := NUMBER ('kg'|'lb') | NUMBER '%' | '?+'
rpe          := '@' NUMBER ['+']
timer        := DURATION '|' (DURATION | '?')   // setTimer|restTimer
setLabel     := '(' text ')'
section      := 'progress' ':' progression
             | 'warmup' ':' (warmupSets | 'none')
             | 'rest' ':' DURATION               // cardio extension
             | 'id' ':' 'tags' '(' INT (',' INT)* ')'
             | 'used' ':' 'none'
progression  := 'none' | 'lp(' args ')' | 'dp(' args ')' | 'sum(' args ')'
             | 'custom(' [stateInit (',' stateInit)*] ')' '{~' script '~}'
DURATION     := NUMBER ('s'|'min'|'m')
```

**Cardio extension** (a runbo superset, documented in the README): a setGroup may be
`[INT 'x'] (DURATION | DISTANCE) ['@Z' 1-5 | '@' NUMBER]` — `Run / 40min @Z2`, `Run / 6x3min @Z4 / rest: 2min`,
`Swim / 8x100m @Z3 / rest: 30s`, `Run / 5km @Z2`. Modality comes from the exercise name (Run / Bike / Swim
and aliases Running, Cycling, Ride, Swimming; see `training/exercises.ts`).

**Reuse** (`src/liftoscript/resolveReuse.ts`) — added in August 2026 when the first real Liftosaur program
arrived and used it on six of its ten lines. Two forms, resolved in a second pass because a line may point at
one not yet read:

- `/ ...t3: Lat Pulldown[1]` copies the target's SETS (deep copy, so the two lines stay independent);
- `progress: custom(increase: 2.5kg) { ...t1: Squat }` copies the target's SCRIPT but keeps the reusing line's
  own `stateInit`. That split is the feature: GZCLP runs one progression for every lift, each with its own
  increment.

Brackets are COORDINATES, not a variation index: one number is a day, two are `[week:day]`. They narrow the
search rather than being required, so a program pasted as a single day still resolves `...Squat[1]`. Reuse may
not chain, and an unresolvable reference is a diagnostic — never a silently empty exercise. The serializer
writes reuse out expanded, since by then the AST holds what the line actually does.

**Not supported (diagnostic required):** `update: custom`, `superset:`, week repetition (`Name[1-4]`),
exercise variations (`A | B | C`), cross-exercise state (`state[1].x`), a `descriptionIndex:` SECTION, and
bodyweight-exercise math. The list is `UNSUPPORTED_CONSTRUCTS` in `diagnostics.ts`. The subset grows only when
a real program needs it — reuse, `ns` and `descriptionIndex`-as-a-variable are what that rule has bought so
far.

### Script language (inside `{~ ~}`)

Statements: assignment (`=`, `+=`, `-=`, `*=`, `/=`), `if` / `else if` / `else`, ternary, `for (var.i in arr)`.
Operators: `+ - * / %`, comparisons, `&& || !`. Values: numbers, weights (`5kg`), percentages.

Read-only: `weights[n]`, `completedWeights[n]`, `reps[n]`, `completedReps[n]`, `RPE[n]`, `completedRPE[n]`,
`amraps[n]`, `numberOfSets`, `setVariationIndex`, `week`, `day`, `dayInWeek`, `rm1`, `bodyweight`.
Writable: `weights`, `reps`, `minReps`, `RPE`, `timers`, `setVariationIndex`, `rm1`, `descriptionIndex`,
`state.x`, `var.x`. runbo renders no descriptions, so `descriptionIndex` is carried and read by nothing — it
exists because real programs assign to it.
Shorthands Liftosaur documents and we accept, rewritten to the long name at parse time: `w` → `weights`,
`r` → `reps`, `cr` → `completedReps`, `ns` → `numberOfSets`.
Bare assignment (`weights += 5kg`) applies to all sets; indexed to one. **Arrays are 1-indexed.**
Comparisons on whole arrays (`completedReps >= reps`) mean "every element satisfies".

Builtins: `floor ceil round sum min max increment decrement roundWeight calculate1RM zeroOrGte rpeMultiplier`.
`calculate1RM(w, r)` = Epley `w × (1 + r/30)`. `roundWeight` / `increment` / `decrement` use the profile's plate
inventory (smallest loadable step = 2 × smallest plate). `zeroOrGte(completed, target)`: every set is 0/skipped
or ≥ target.

`lp` / `dp` / `sum` are **desugared to equivalent custom scripts** at parse time (`progressions.ts`) so there is
a single evaluation path:

- `lp(inc)` / `lp(inc, s, c, deload, f, c2)`: after `s` consecutive successes `weights += inc`; after `f`
  consecutive failures `weights -= deload`. Defaults `s = 1`, `f = 0` (never deload).
- `dp(inc, minR, maxR)`: success at current reps → `reps += 1` until `maxR`, then `weights += inc`, reps back
  to `minR`.
- `sum(target, inc)`: `sum(completedReps) >= target` → `weights += inc`.

### Module API (`src/liftoscript/`)

```ts
parseProgram(source: string): { program: Program; diagnostics: Diagnostic[] }
parseProgramOrThrow(source: string): Program
desugarProgram(program: Program): Program
exerciseKey(exercise: ExerciseLine): string        // 'T1:Squat' — the programState key
prescribe(program, exerciseName, exerciseState, ctx): {
  sets: { reps; minReps?; isAmrap; weight: WeightValue; timerSec? }[]
  warmup: { reps; weight: WeightValue }[]
}
evaluateSession(program, exerciseName, exerciseState, sessionLog: SetLog[], ctx): {
  nextState: ExerciseState; summary: string       // 'Squat: 5×3+ → 6×2+, weight held at 100 kg'
}
serializeProgram(program: Program): string        // parse → serialize → parse is stable
formatDiagnostic(d: Diagnostic): string
```

`ctx: EvalContext = { units, plates, barbellWeight, week, day, bodyweight? }`.
`weight.ts` owns the `Weight` arithmetic: `convert add subtract multiply ratio applyPercent compare equals
format roundToStep smallestStep roundWeight increment decrement platesFor calculate1RM`.

Tests: one spec per module plus `roundtrip.spec.ts` and `integration.spec.ts`; fixtures in
`__tests__/fixtures/` — the built-in GZCLP text, a stock Liftosaur GZCLP copy, a cardio-extension file, a
`misc.txt`, and `unsupported.txt` (every unsupported construct must yield ≥ 1 diagnostic with the right line).

---

## Built-in GZCLP program

`src/training/gzclp.ts` holds `GZCLP_PROGRAM_SOURCE` as a template. One week block of four days; the scheduler
cycles `GZCLP_ROTATION = ['A1', 'B1', 'A2', 'B2']` through `rotationCursor`, so Liftoscript week repetition is
never needed. Tiers are recognized by the `T1:` / `T2:` / `T3:` labels (rest-timer defaults, warmup policy,
heavy-lower-day detection).

```
## A1
T1: Squat / 5x3+ / 6x2+ / 10x1+ / 100kg / warmup: 1x5 20kg, 1x3 55%, 1x2 75% / progress: custom(inc: 5kg, resetFactor: 0.85) {~
  if (completedReps >= reps) {
    weights += state.inc
  } else if (setVariationIndex >= 3) {
    setVariationIndex = 1
    weights = roundWeight(weights[1] * state.resetFactor)
  } else {
    setVariationIndex += 1
  }
~}
T2: Bench Press / 3x10 / 3x8 / 3x6 / 60kg / warmup: 1x5 20kg, 1x3 55% / progress: custom(inc: 2.5kg, resetFactor: 0.85) {~ …same script… ~}
T3: Lat Pulldown / 3x15+ / 40kg / warmup: none / progress: custom() {~ if (completedReps[3] >= 25) { weights += 2.5kg } ~}
## B1   T1 Overhead Press · T2 Deadlift · T3 Bent Over Row
## A2   T1 Bench Press · T2 Squat · T3 Lat Pulldown
## B2   T1 Deadlift · T2 Overhead Press · T3 Bent Over Row
```

- `state.inc` carries the per-lift increment: 5 kg Squat / Deadlift, 2.5 kg Bench / OHP (same for T1 and T2).
- The success test is `completedReps >= reps`, **not** `zeroOrGte`: in GZCLP a set you did not do is a failed
  session, and at T1 stage 3 (`10×1+`) a miss *is* a zero — `zeroOrGte` would forgive it and the stage would
  never reset.
- Deadlift warmups start from 60 kg (the bar on plates), not the empty bar.

API: `gzclpProgram()`, `buildGzclpProgram(seed)` (substitutes starting weights or `?+`), `initialProgramState(
source, seed)`, `seedFromFiveRepMax(lift, fiveRm, load)` (T1 = 85 %, T2 = 65 %, stage 1),
`seedFromOneRepMax`, `tierOf`, `restTimerFor(tier, timers)`, `programDayAt(cursor)`, `nextCursor`,
`containsLowerLift(day)`, `isHeavyLowerDay(day)`.

---

## Training domain

All modules in `src/training/` are pure; each has a spec in `__tests__/`, plus `simulation.spec.ts` (12 weeks
of scripted results driven through composer + evaluator).

### Composer (`composer.ts`)

```ts
composeWeek(input: ComposeWeekInput): ComposedWeekPlan
claimToday(week, dateIso, input): ComposedWeekPlan
swapToday(week, dateIso, input): ComposedWeekPlan
explainPlacement(week): string[]
```

`ComposeWeekInput = { weekStart, availability, rotationCursor, programDays, cardioSessions, loggedSessions }`
— `programDays` are the program's day names in rotation order (the cursor is only an index),
`cardioSessions` is this week's plan from `planCardioWeek`.

Algorithm (deterministic):

1. Training-day budget = `daysPerWeek`, placed on `preferredDays` (fill from Monday if fewer preferred than
   budget). Strength gets `min(strengthDaysPerWeek, budget)` days — the athlete's setting, defaulting to
   `DEFAULT_STRENGTH_DAYS_PER_WEEK` (3) for a profile written before the field existed — and cardio the rest
   (min 1 if any modality is enabled). `trainingWeekdays`, `weeklyTrackBudget`.
2. Place strength first, spread with ≥ 1 calendar day between them when possible (`chooseSpreadDays`,
   `cyclicGaps`). Assign program days from `rotationCursor`.
3. Place cardio: long session on `longSessionDay` if it is a training day; the intervals session on a day that
   is not immediately before a heavy-lower day (A1, B1, B2) and not the day before the long session; easy
   sessions fill the rest.
4. Already-completed sessions this week stay fixed; only future days recompose.

Interference predicates (exported, tested): `isHardCardio`, `sharesDayWithStrength`,
`isDayBeforeHeavyLower`, `canPlaceHardCardio`, `canPlaceLongSession`, `demoteToEasy` (long → easy of the same
minutes when it cannot be placed cleanly). One session per day in MVP, so "no hard cardio on a strength day"
is implicit.

Overrides: `claimToday` marks an unplanned day available and returns the most valuable session (overdue
strength first, else the next cardio of the week). `swapToday` replaces today's item with the other track's
next item and recomposes the rest of the week. Nothing is ever skipped — cursor semantics.

### Cardio planner (`cardioPlan.ts`)

```ts
planCardioWeek(cardioTrack, lastWeekCompletionRatio, cardioDays): CardioWeekPlan
growLongestSession(current, completedMinutes): number
```

`CardioWeekPlan = { sessions, weeklyMinutes, isDeload, next* }` where the `next*` fields (`nextMesoWeek`,
`nextBaseline`, `nextHoldStreak`, rotation cursor, planned minutes) are **persisted back to `cardioTrack`**
when the block is adopted — without that the adaptive step-back and modality rotation restart every block.

- `mesoWeek` 1–3: `weeklyMinutes = baseline × 1.08^(mesoWeek − 1)`; week 4: `baseline × 0.6`; after week 4 the
  week-3 volume becomes the baseline and `mesoWeek` resets to 1.
- `lastWeekCompletionRatio = done / lastPlannedMinutes`. `< 0.7` → hold (repeat the last block's minutes, do
  not advance `mesoWeek`); twice consecutively → `baseline × 0.9`, restart `mesoWeek` at current.

### Training block (`cardioBlock.ts`)

```ts
BLOCK_LENGTH = 7
blockAnchorOf = startOfWeekMonday
blockWindowStart(cardioTrack): string | null
blockRatio(cardioTrack, sessions): number
cardioBlockAction(cardioTrack, sessions, todayIso): CardioBlockAction
```

**The mesocycle walks training blocks, not calendar weeks.** A block is seven days from `blockStartDate`, and
it only ends when seven days have passed **and something was trained inside it**. Time alone can never push
anyone into a deload.

`CardioBlockAction` is the whole rollover rule as data, so the store only decides *when* it is safe to write:

| Action | When | What is persisted |
|---|---|---|
| `idle` | no block and no session yet; or the window is still running | nothing |
| `start` | the first completed session ever | `blockStartDate` = the Monday of that session's week |
| `skip` | the window ended with **nothing** trained in it | `blockStartDate` only — `mesoWeek`, `weeklyMinutes`, `holdStreak`, `lastPlannedMinutes` are untouched |
| `advance` | the window ended and was trained in | the whole `planCardioWeek` result, plus the next anchor |

- The gate is **any** completed session, not a cardio one: an athlete who lifted three times and skipped every
  run genuinely missed their cardio and the volume *should* hold. An athlete who did nothing has not failed a
  block — they were away, and `comeback.ts` owns long absences.
- A long absence produces **exactly one** `skip`, whatever its length. Three months away is a single write and
  the athlete returns to the mesocycle week they left.
- `blockRatio` measures the window **before** the stored block, which is the one `lastPlannedMinutes` is the
  divisor for. An empty previous window scores **1**, not 0 — scoring an absence as a miss is exactly the
  double punishment (hold, then a 10 % step back, on top of the comeback's 70 %) this module exists to end.
- Applying an action and re-asking yields `idle`. That idempotence is what makes a reload, a second tab or a
  duplicated snapshot safe.
- A profile written before `blockStartDate` existed carries a legacy `mesoStartDate` (block 1's Monday, with
  `mesoWeek` counting from there). `blockWindowStart` derives the anchor from it — losslessly, so there is **no
  migration** — and the first write of `cardioTrack` replaces the slice wholesale and the legacy field is gone.
  It is read as validated `unknown`, not declared on `Profile`: nothing may write it again.
- Split for N cardio days: 1 long (≈ 40 % of minutes, capped at `longestSessionMinutes × 1.1`), 1 intervals if
  `weeklyMinutes ≥ 120` (`6 × 3 min work / 2 min rest` at Z4, ≈ 25 % of minutes), remainder as easy Z2 sessions
  (min 20 min each; merge if shorter).
- Modality rotation run → bike → swim over the enabled set; never the same twice in a row when 2+ enabled; swim
  never gets the long session unless it is the only modality.

### Schedule (`schedule.ts`)

```ts
planWeek(profile, sessions, anchorIso, fromDate?): WeekPlan
resolveToday(profile, sessions, todayIso): TodayResolution
cardioOf(week): CardioPrescription[]
```

`TodayResolution = { item, isRestDay, isDeloadWeek, catchUp, comebackProposal, daysSinceLastSession }`. `catchUp`
is what claiming today would offer — set only on a rest day with work outstanding. This is the one function
TodayView calls.

### Comeback (`comeback.ts`)

`proposeComeback(profile, sessions, todayIso): ComebackProposal | null` after `≥ comebackGapDays` (default 10)
without any session; `applyComeback(...)` writes the new state. Factors `STRENGTH_FACTOR = 0.9` (stages kept),
`CARDIO_FACTOR = 0.7`, `RAMP_WEEKS = 2`; `comebackFactorsForWeek(week)` gives week 1 = those factors, week 2 =
halfway to normal, week 3 = normal. The proposal is **offered on Today, never auto-applied**.

### Readiness (`readiness.ts`)

`scoreReadiness({ sleep, energy, soreness })` → total (3–15) and `readinessBand` (`good | ok | poor`);
`readinessAdvice(score, kind)` returns the suggestion text when `score ≤ ADVICE_THRESHOLD (7)`: strength
"consider skipping the AMRAP set", cardio "shorten to 70 % of target". Never mutates program state; stored on
the session doc.

### Zones (`zones.ts`)

`hrZones(hr)`: from LTHR (Z1 < 68 %, Z2 68–83 %, Z3 84–94 %, Z4 95–105 %, Z5 > 105 %) when given, else from max
HR (Z1 50–60 %, Z2 60–70 %, Z3 70–80 %, Z4 80–90 %, Z5 90–100 %); `maxFromAge(age) = 208 − 0.7 × age`.
`paceZones(modality, recent)` from a recent performance; units sec/km (run), km/h (bike), sec/100 m (swim).
`describePrescription(...)` renders HR range and/or pace range plus the `rpeCue(zone)` verbal cue — always.

### Plates (`plates.ts`)

`platesForWeight(target, settings): PlateLoad` — exact per-side plate list from the profile inventory and
barbell weight; `roundToLoadable`, `nextLoadableUp/Down`, `formatPlatesForWeight` ("20 + 20 + 10 + 1.25 per
side"). `evalContextFromSettings(settings, …)` builds the Liftoscript `EvalContext`.

### Stats (`stats.ts`)

`estimatedOneRepMax(set)`, `bestSetFor`, `personalRecords(sessions)` (kinds `weight | e1rm | amrapReps`),
`detectNewRecords(sessions, session)` (used by the completion summary), `weeklyTonnage`, `weeklyCardioMinutes`,
`cardioCompletionRatio(sessions, windowStart, targetMinutes)` (any 7-day window — the calendar week for the
tiles, the training block for the adaptive ratio), `currentStreak(profile, sessions, todayIso)` and
`streakGapLimit(profile)`.

**The streak counts sessions, not weeks.** It is the number of completed sessions in the current unbroken run:
same-day logs count once, and the run ends at the first gap wider than `streakGapLimit` =
`min(ceil(7 / daysPerWeek) + 3, comebackGapDays)` — the athlete's own day spacing plus one skipped slot, and
never past the gap at which the app already offers a comeback. No Monday buckets: a Sunday and the Monday
after it used to score 2, and so did two sessions thirteen days apart.

`bodyweightTrend` (7-day rolling average — a smoothing window, unrelated to weeks), `weeklyRollup`.

### Exercises (`exercises.ts`) and dates (`utils/date.ts`)

`EXERCISES` catalog with aliases: `resolveExercise`, `canonicalName`, `modalityOf` (Run/Bike/Swim aliases for
the cardio extension). Date helpers: `toIso parseIso isIsoDay addDays weekdayIndexMondayFirst
startOfWeekMonday daysBetween inWeek formatHuman` plus `WEEK_LENGTH` and `WEEKDAY_LABELS` — the only place
`Date` is touched. `isIsoDay` is the non-throwing guard for data the app did not just write (a Firestore
document, a wizard draft mid-typing, a legacy field); `parseIso` throws on everything it rejects.

---

## Firebase client layer

Phase 4. Hand-written service layer, **no VueFire**.

- `src/services/firebaseApp.ts` — `initializeApp`, `getAuth`, `initializeFirestore` with persistent multi-tab
  cache and `ignoreUndefinedProperties: true`; emulator hookup behind `VITE_USE_EMULATOR`.
- `src/services/firebaseService.ts` — generic `load / list / save / delete / subscribeDoc / subscribeQuery`
  and auth helpers (`signInWithGoogle` via popup, `signOut`, `onAuthStateChanged`).
- `src/constants/firebaseCollections.ts` — typed collection refs with `createConvertor<T>()` for `profiles`,
  `sessions`, `bodyweight`, `config`.
- Per-entity services: `profileService`, `sessionsService`, `bodyweightService`, `allowlistService`
  (reads `config/allowlist`).

Stores (Pinia):

- `useAuthStore` — `user`, `status: 'loading' | 'signedOut' | 'notAllowlisted' | 'ready'`, `signIn`, `signOut`.
- `useProfileStore` — live `profile` (subscribed), `save(partial)`, `ensureProfile()` creates the default doc on
  first sign-in with `onboarding.completed = false`.
- `useSessionsStore` — live "this week" query and paged history; `startSession`, `finishSession` (writes
  `stateSnapshot`, runs `evaluateSession` per exercise, saves `progressionSummary`, updates
  `programState` + `rotationCursor`), `deleteLastSession` (restores the snapshot).
- Persist plugin (localStorage, prefix `runbo:`) for UI prefs only.

Router guard: signed out → `/signin`; signed in but `status === 'notAllowlisted'` → `/signin` (ask-for-access
state); `profile.onboarding.completed === false` → `/onboarding/:step` with the saved step.

---

## Import

Phase 5, `src/import/`, pure and fixture-tested.

- `programText.ts` — wrapper over `parseProgram` + adoption: seeds `programState` from the program's weights,
  `?+` → `askWeight: true`.
- `liftosaurHistory.ts` — tolerant mapper Liftosaur JSON export → `Session[]` with a report
  (`imported / skipped + reasons`). Field names are verified against a real export **when the user provides
  one**; until then build against the documented shape, cover with a fixture, mark clearly.
- `deriveState.ts` — from imported sessions + parsed program: per exercise, weight = last completed working
  weight; `setVariationIndex` = the program variation whose set count × reps matches the last session;
  `rotationCursor` = the day after the last logged program day.

Unsupported constructs → `DiagnosticsList` with line/col and the fallback offer "keep detected weights, run
built-in GZCLP".

---

## Onboarding wizard

Route `/onboarding/:step`, progress saved to `profiles/{uid}.onboarding.step` after every step; resumable;
"Skip setup" accepts defaults (GZCLP with all lifts as `?+`, 2 × 30 min cardio baseline).

| Step | Content | Form component (shared with Settings) |
|------|---------|----------------------------------------|
| 0 | Sign-in | — |
| 1 | Gym setup: units, barbell weight, plate inventory | `settings/GymForm` |
| 2 | Program — two equal paths: **Continue from Liftosaur** (paste text, optional JSON export, inline diagnostics, fallback offer, editable derived-state confirmation) · **Start fresh with GZCLP** (per lift: working weight + stage for T1/T2, T3 weights; "I don't know" computes from a 5RM; empty = ask-weight) | `settings/ProgramForm`, `program/ProgramEditor`, `DiagnosticsList` |
| 3 | Cardio: modalities, honest current weekly minutes, longest session | `settings/CardioForm` |
| 4 | Zones (optional): max HR or age, LTHR, recent performances | `settings/ZonesForm` |
| 5 | Availability: days/week, preferred days, long day — with live preview of the composed week | `settings/AvailabilityForm` |
| 6 | Review & start | — |

---

## Views & components

Views are thin; every rule lives in a pure module.

- `SignInView` — Google button; not-allowlisted state ("ask for access", shows the signed-in email).
- `TodayView` — `resolveToday` card: strength day (program day + first exercise's weights), cardio
  prescription (`describePrescription`), or rest; claim-today and swap controls; comeback proposal; deload
  badge; the streak tile (`currentStreak`, in **sessions**) and the "this week" tiles (`weeklyRollup`, over the
  **calendar** week); bodyweight quick add. It also drives the training-block rollover: `cardioBlockAction` off
  the stored anchor, adopted through the profile store.
- `StrengthSessionView` — `TierBlock` per tier, `SetRow` with tap cycling, AMRAP stepper, `PlateHint` per set,
  `RestTimer` (tier default or program timer), readiness sheet on entry, completion summary with
  `progressionSummary` lines and `detectNewRecords`.
- `CardioSessionView` — `PrescriptionCard` + `CardioLogForm` (minutes, distance, avg HR, RPE, notes); a
  matched Strava activity shows as completed.
- `PlanView` — composed week, planned vs done per day, deload badge, `explainPlacement` lines.
- `HistoryView` — list; delete the most recent session with confirmation → restores `stateSnapshot`.
- `ProgressView` — per-lift weight and e1RM `LineChart`s, weekly cardio `BarChart` vs target, PR list,
  bodyweight trend, readiness vs performance. Charts are hand-rolled SVG; load the `dataviz` skill first.
- `ProgramView` — `ProgramEditor` (text + diagnostics), per-exercise current state, copy-out.
- `SettingsView` — all form sections, rest timers, comeback threshold, Strava connect card, notification
  toggles (request permission here only), JSON export of all user data.

Components: `AppNav` (bottom, Today / Plan / Progress / History / Settings), `StatTile`, `LineChart`,
`BarChart`, `strength/TierBlock`, `strength/SetRow`, `strength/PlateHint`, `RestTimer`,
`cardio/PrescriptionCard`, `cardio/CardioLogForm`, `program/ProgramEditor`, `DiagnosticsList`, `settings/*Form`.

Style: `style.css` = `@import 'tailwindcss'; @import 'vuiii/style.css';` + `@theme` tokens — one orange
`accent` scale and a cool `ink` neutral scale. Light mode only; vuiii's dark blocks are never activated.

---

## Cloud Functions

Phase 10. `functions/` on nodejs24, layout from `pubquiz/functions`. Secrets via
`defineSecret('STRAVA_CLIENT_ID' | 'STRAVA_CLIENT_SECRET')` plus a webhook verify token.

### Strava

| Function | Type | Behaviour |
|----------|------|-----------|
| `stravaAuth` | https | Redirect to Strava OAuth, scope `activity:read`, `state` = signed uid |
| `stravaCallback` | https | Exchange code, store tokens + `athleteId` in `stravaAccounts/{uid}`, redirect to `/settings` |
| `stravaWebhook` | https | `GET` echoes `hub.challenge` after checking the verify token. `POST` returns 200 immediately, then processes the event (see below) |
| `stravaBackfill` | callable | Pull the last 30 activities after connecting and run them through the same mapper |

Webhook event processing:

1. `object_type === 'athlete'` and `updates.authorized === 'false'` → **deauthorization**: look up the account
   by `athleteId`, delete `stravaAccounts/{uid}`; the Settings card falls back to "Connect". *(Harvested from
   RunPlan Pro; extends the brief.)*
2. `object_type === 'activity'`, `aspect_type` `create` / `update` → refresh the token if expired → fetch the
   activity → map `sport_type`: `Run`, `TrailRun` → `run`; `Ride`, `VirtualRide`, `GravelRide` → `bike`;
   `Swim` → `swim`; anything else is ignored → upsert a session `{ kind: 'cardio', source: 'strava',
   externalId, date, minutes, distanceKm, avgHr, status: 'done' }`, **dedup by `externalId`**.
3. If that date holds an unfinished cardio prescription in the composed week, attach it (`prescription`) and
   the day counts as done; otherwise the session is unplanned and still counts toward weekly volume.
4. `aspect_type === 'delete'` → remove the session with that `externalId` if `source === 'strava'`; a
   prescription it had claimed becomes open again. *(Extends the brief.)*

Rate limits: Strava enforces per-application quotas (on the order of 100–200 requests per 15 minutes and
1,000–2,000 per day; the dashboard shows the exact figures). At 1..n users this is not a concern; log the
`X-RateLimit-Usage` header and back off on HTTP 429 with a single retry.

### Notifications

`sendDailyNotifications` — scheduled `0 7 * * *`, tz `Europe/Bratislava`. Computing `resolveToday` server-side
would duplicate the domain code in Functions, so **the client writes tomorrow's plan summary to
`profiles/{uid}.nextPlanned` on every recompose**; the function only reads it. For each profile:

- `notifications.daily` and `nextPlanned` present → push "Today: …".
- `notifications.gapNudge` and `daysSinceLastSession >= comebackGapDays` → push the comeback nudge.

FCM tokens live in `profiles/{uid}.settings.fcmTokens`. The client requests permission **from Settings only**,
obtains a token with the VAPID key, `arrayUnion`s it, and refreshes it on app load when permission is granted.
`public/firebase-messaging-sw.js` handles background messages. When a send fails with
`messaging/registration-token-not-registered`, the function `arrayRemove`s that token.

---

## PWA & offline

Phase 9. `vite-plugin-pwa` with `registerType: 'autoUpdate'`; manifest name `runbo`, `display: standalone`,
`start_url: '/'`, theme color = accent; simple lettermark PNG icons (192, 512, 512 maskable). Workbox
precaches the app shell (`**/*.{js,css,html,ico,png,svg,woff2}`).

Offline data is **Firestore's persistent local cache**, not the service-worker cache:

| Feature | Offline |
|---------|---------|
| Today / Plan / History / Progress | cached data, auto-sync on reconnect |
| Logging a strength or cardio session, bodyweight | queued write, synced on reconnect |
| Program edit, settings | queued write |
| Strava connect / backfill, notification permission | need network — show a plain notice |

Update prompt (`src/components/UpdatePrompt.vue`): a non-blocking bar, "A new version is available", with
Update and Later. `autoUpdate` installs the worker by itself; the prompt only asks when to RELOAD, because
reloading mid-set would throw away a session the athlete is standing in the gym to log. Dismissing is
per-page-load, not persisted — the next visit offers it again, which is the right cadence for something
accepted between sessions rather than during one. A registered worker is re-checked hourly, since a PWA kept
on a home screen can run for weeks without a full load. No install banner in MVP — the user installs from
the browser menu.

The manifest is generated by the plugin, so there is exactly one: a second hand-written
`public/manifest.webmanifest` used to sit beside it carrying an empty `icons` array, which made the app
installable under neither. Icons are a lettermark rendered from `public/icon.svg`; the maskable one is a
separate file with the glyph inside the safe area, not the same image relabelled — Android crops to a circle
and a full-bleed letter loses its stem.

Verified by serving the build, killing the server and reloading: the shell comes back from the precache
(81 entries). Offline WRITES are Firestore's persistent cache, configured in Phase 4, and are not exercised
by that test.

---

## Error handling

- **Program text** — never throws at the user: `parseProgram` returns diagnostics; `DiagnosticsList` renders
  `line:col message` with the source line and a caret. `parseProgramOrThrow` is for tests and trusted built-in
  text only.
- **Domain modules** — pure functions; invalid input is a programming error and may throw. Views guard with
  the store's loading state, not with try/catch around domain calls.
- **Firestore** — service-layer calls surface `FirebaseError` codes; views show a vuiii toast with a short
  English message (`permission-denied` → "You don't have access to this", `unavailable` → "You're offline;
  changes will sync later"). Offline writes are not errors.
- **Auth** — popup closed / cancelled is silent; `auth/popup-blocked` shows a hint to allow popups.
- **Functions** — `logger.error` with the uid and Strava ids; webhook handlers always return 200 to Strava
  and log failures instead of retrying indefinitely.

---

## Testing strategy

- **Unit tests (vitest)** on every pure module — `src/liftoscript/`, `src/training/`, `src/import/`,
  `src/utils/`. Fixtures in `__tests__/fixtures/`. Currently 20 spec files / 450 tests, all green.
- **Simulation test** (`training/__tests__/simulation.spec.ts`): 12 weeks of scripted results (successes,
  failures, misses) driven through composer + evaluator, asserting stage transitions, resets, mesocycle
  volumes, deload week, adaptive hold, comeback trigger.
- **Round-trip test**: `parse → serialize → parse` is stable for every fixture.
- **Rules check** (Phase 4): a small script against the Firestore emulator (REST or
  `@firebase/rules-unit-testing`) proving user A cannot read user B's profile or sessions and a
  non-allowlisted user cannot read anything but `config`.
- **Functions** (Phase 10): unit tests for the Strava mapper (sport types, dedup, date handling) with recorded
  activity JSON; the webhook run end-to-end in the emulator.
- **Manual acceptance** per phase (see below) — there is no component test suite and no Playwright, so no
  `.vue` file is covered by an automated test. CI runs type-check, lint and the unit tests before it deploys;
  it proves the code compiles and the pure modules behave, not that a screen works.

---

## Deployment & operations

- **CI** (`.github/workflows/deploy.yml`): a push to `master` — which is how a merged PR arrives — runs
  type-check, `lint:ci` and the tests, and only then builds and deploys hosting plus the Firestore rules and
  indexes. Deploys queue rather than cancel, because interrupting `firebase deploy` half-way is worse than
  waiting. Phase 10 must add `functions` to the deploy target.
  - `lint:ci` is `oxlint` with no `--fix`: the local `lint` script rewrites files, which in CI would silently
    patch a finding and report success.
  - Auth is a service account JSON in the `FIREBASE_SERVICE_ACCOUNT` secret, written under `RUNNER_TEMP` and
    removed afterwards. The project comes from `.firebaserc`, so the repo stays the one source of truth.
  - The `VITE_APP_FIREBASE_*` values are repository secrets because Vite bakes them into the bundle at build
    time. They are not sensitive — they ship to every browser — but they are kept out of the repo so it does
    not carry one project's identity.
  - `scripts/setupCiSecrets.sh` puts all of it in place: it copies the client config out of `.env.local` and
    creates a `github-deploy` service account holding only the four roles a deploy needs, then uploads its key
    and deletes it. Run it yourself — it mints a credential.
- Manual: `npm run deploy` = build + `firebase deploy --only hosting,firestore`.
- Secrets: Strava client id/secret and the webhook verify token via `firebase functions:secrets:set`. Never in
  the repo or `.env`.
- Webhook subscription is created once per environment with a `curl` to Strava's push-subscriptions endpoint
  pointing at the deployed `stravaWebhook` URL; document the command in `functions/README.md`.
- Monitoring: Cloud Functions logs are sufficient at this scale; no analytics events, no health endpoint.
- **Data export**: Settings → "Export my data" builds a JSON of profile, sessions and bodyweight client-side
  from the live Firestore data (no function needed). Account deletion is milestone 2.
- Backups: Firestore scheduled exports are not configured for MVP; the JSON export is the user's backup.

---

## Accessibility

- Semantic HTML (`<button>`, `<a>`, `<input>`, `<nav aria-label>`); `aria-label` on icon-only buttons;
  `aria-live` on the rest timer and toasts.
- ≥ 48 px tap targets (bottom nav uses 56 px), big numerals on session screens, one accent for the primary
  action.
- Respect `prefers-reduced-motion` for the rest-timer ring and chart transitions.
- Contrast: the `ink` and `accent` scales are chosen for ≥ 4.5:1 on white; check new colors before adding.
- Charts carry a text summary (`<title>` / visually hidden list) so numbers are available without vision.
- Manual VoiceOver pass on iOS before each phase that adds a screen. No lint plugin — oxlint is the only linter.

---

## Phases & status

| # | Phase | Acceptance | Status |
|---|-------|------------|--------|
| 0 | Repo consolidation — fitko scaffold moved into `runbo`, docs to `docs/`, old dirs removed | `npm run dev` serves the shell; clean git status | ✅ `e07ef1a` |
| 1 | Shell — deps, `style.css` (light only), `icons.ts`, router with all routes, `AppNav`, empty views | `type-check`, `build`, `lint` pass; bottom nav with 5 tabs | ✅ `216a8a8` |
| 2 | Liftoscript engine — all modules + tests + fixtures | `npm run test` green; round-trip stable; every unsupported construct yields a diagnostic with correct line; GZCLP cases: success → +weight, fail → stage+1, fail at stage 3 → reset to 85 % rounded, T3 25+ → +2.5 kg | ✅ `216a8a8` |
| 3 | Training domain — gzclp, cardioPlan, composer, schedule, stats, plates, comeback, readiness, zones, exercises, `utils/date`, 12-week simulation | tests green incl. simulation; `platesForWeight(102.5 kg)` returns the exact per-side list | ✅ `70a66d2` |
| 4 | Firebase — services, collections, rules + allowlist gate, indexes, `firebase.json`, stores, persist plugin, `SignInView`, router guard | with emulators: sign-in works; non-allowlisted account sees ask-for-access; rules check proves isolation | ⬜ next |
| 5 | Import — `programText`, `liftosaurHistory`, `deriveState` + fixtures | tests green; stock GZCLP fixture parses clean; unsupported fixture shows `DiagnosticsList` with line/col | ⬜ |
| 6 | Onboarding — wizard, shared form sections, both program paths | fresh path → Today shows A1 with correct weights; import path → editable derived state; resume after reload; skip lands on Today with ask-weight prompts | ⬜ |
| 7 | Training loop — `TodayView` (claim, swap, comeback, bodyweight), `StrengthSessionView`, `CardioSessionView` | log A1 with a deliberate T1 miss → summary shows stage advance; next Today shows B1; swap recomposes the week; deleting the last session restores weights | ⬜ |
| 8 | Plan / Progress / History / Program / Settings; charts; JSON export | charts render with fixture data; weekly bars show target vs done; PR list populates | ⬜ |
| 9 | PWA — `vite-plugin-pwa`, manifest, icons, shell caching | manifest + service worker verified on the built app; killing the server and reloading still renders the shell from the precache. The reconnect half is Firestore's cache (Phase 4) and stays unverified | ✅ |
| 10 | Functions — Strava auth/callback/webhook/backfill, notifications, Settings Strava card | emulator webhook POST with a recorded activity creates a matched session; scheduled function sends (or logs) the payload; mapper tests green | ⬜ |

**User-provided prerequisites** (ask when reaching the phase, do not block earlier ones): Firebase project +
`.env.local` (Phase 4); Liftosaur JSON export + current program text (Phase 5 fixtures); Strava API app
credentials (Phase 10); `firebase login` + deploy approval (end).

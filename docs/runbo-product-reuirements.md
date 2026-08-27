# runbo — Product Requirements

**Version 2.0 | August 2026**

Supersedes *RunPlan Pro — Product Requirements Document v1.1* (January 2026). RunPlan Pro was a running-only,
race-goal-driven exploration; runbo is what it merged into. The previous version of this file is preserved in
git history (commit `e07ef1a`) and its still-useful ideas are listed in the last section.

---

## What runbo is

runbo is a personal athletic-development app. It runs a **GZCLP strength program** (written in Liftoscript and
executed by our own interpreter) alongside **prescribed cardio** (run / bike / swim), and merges both into one
week using the user's real availability.

**Goal statement (user's wording):** *Cieľom je vytvoriť aplikáciu, ktorá by komplexne rozvíjala atletické
schopnosti používateľa — ako silovým tréningom, tak i kardio tréningami.* — an app that develops the user's
athletic abilities comprehensively, through strength training as well as cardio.

One sentence: **runbo tells you what to do today — the right GZCLP session with the right weights, or the right
cardio session at the right intensity — and keeps both tracks progressing without you doing the bookkeeping.**

---

## Problem

Combining a barbell program with endurance work by hand means:

- remembering GZCLP's stage rules (T1 `5×3+ → 6×2+ → 10×1+`, T2 `3×10 → 3×8 → 3×6`, T3's 25-rep rule) and
  applying them correctly after every session, including the 85 % reset;
- doing the weight and plate math between sets;
- deciding each week how much cardio to do, at what intensity, and on which days so that it does not wreck the
  next heavy lower-body day;
- noticing when cardio volume has quietly stalled, or when a two-week break needs a gentler restart;
- keeping all of this straight across a schedule that changes week to week.

Existing tools cover one half each: Liftosaur runs the lifting program but knows nothing about cardio load;
running apps periodize cardio but ignore the barbell. Nothing composes the two into one honest week.

---

## Users

runbo is built for **1..n users**, gated by an allowlist during MVP. The first user is the author; a handful of
friends may follow. This shapes the product:

- **Google sign-in only**, no registration flow, no password reset. Access is granted by adding an email to the
  allowlist; everyone else sees an "ask for access" screen.
- No marketing surface, no social features, no coach/athlete roles.
- Every user connects their **own Strava account**; there is one shared Strava API application.

| Who | Situation | What they need |
|-----|-----------|----------------|
| The author | Intermediate lifter on GZCLP, does 2–3 cardio sessions a week, trains in a bright gym holding a phone at arm's length | Today's session with weights and plates worked out; a week that respects real availability; cardio that actually progresses |
| Friends on the allowlist | Same shape: strength program + some cardio, busy calendar | The same, plus an easy import of their existing Liftosaur program and history |

---

## Product decisions (settled — do not reopen)

### Tracks and goals

- Two **orthogonal tracks**, each with its own goal: **strength** (GZCLP) and **cardio**.
- Goal type is `'open' | 'race' | 'numeric'` in the data model. **MVP implements only `'open'`** (maintain and
  grow). Race periodization and numeric strength targets with ETA projection are milestone 2: model ready, no UI.

### Strength

- **Programs are Liftoscript text** (the notation from Liftosaur). GZCLP ships as built-in program text; the
  user can paste their own program instead. T3/accessory changes are made by editing the text — there is no
  exercise picker UI.
- The app implements a documented **Liftoscript subset**. Anything outside it fails loudly with line/column
  diagnostics; nothing silently misbehaves.
- runbo adds a small **cardio extension** to Liftoscript (durations, distances, `@Z2` zones, `rest:` section),
  so cardio prescriptions can be expressed in the same notation.
- **Set logging is Liftosaur-style tap cycling**: tap 1 marks the set done at prescribed reps and starts the
  rest timer; each further tap decrements reps (5 → 4 → 3 …); below 0 the set is skipped; the next tap returns it
  to untouched. AMRAP sets always use a numeric stepper.
- **Warmups are auto-generated** for T1/T2 via the program's `warmup:` section (empty bar ×5, ~55 % ×3, ~75 %
  ×2, rounded to loadable weights). Imported programs' own `warmup:` is honored; `warmup: none` disables.
- **Plate hints** per set from the user's plate inventory and barbell weight.
- **Rest timers**: defaults T1 3:00, T2 2:00, T3 1:00, configurable per tier in Settings; explicit timers in
  program text always win.
- **History is read-only.** Finished sessions are never edited. Only the most recent session can be deleted,
  which restores program state from the snapshot stored on that session — there is no recomputation engine.

### Cardio

- **Cardio is prescribed, not just logged.** 4-week mesocycles: weeks 1–3 grow weekly minutes by 8 % each,
  week 4 is a deload at 60 %. After week 4 the week-3 volume becomes the new baseline.
- Mostly Zone 2. One intervals/tempo session per week once volume reaches 120 min/week. The weekend slot
  (or the user's chosen "long day") holds the long session.
- **Modality rotates** (run → bike → swim among the enabled ones), never the same twice in a row when two or
  more are enabled; swimming never gets the long session unless it is the only modality.
- **Adaptive**: if less than 70 % of last week's target was completed, volume holds; two such weeks in a row
  step the baseline back 10 %.
- **Intensity is expressed in zones** from HR and/or pace — whatever the user provided — always with an RPE and a
  verbal cue fallback ("conversational pace"). HR zones from LTHR (Friel percentages) when known, else from
  max HR (measured or `208 − 0.7 × age`).
- **Strava is the cardio data source**: activities arrive via webhook and are auto-matched to that day's
  prescription. **Manual entry is the fallback** and works before Strava is configured.

### Calendar composer

- The composer merges both tracks into the week from the user's **availability**: days per week, preferred
  days, preferred long-session day. Strength gets up to 3 of the training days, cardio the rest.
- **Interference rules**: one session per day; no hard cardio (intervals/tempo) or long session the day
  before a heavy lower-body day (A1, B1, B2); if a long session cannot be placed cleanly it is demoted to an
  easy session of the same length.
- Already-logged sessions this week stay fixed; only future days recompose.
- **Claim today**: on a rest day, the user can mark themselves available and get the most valuable outstanding
  session (overdue strength first, else the next cardio of the week).
- **Swap today**: replace today's item with the other track's next item; the rest of the week recomposes.
  Nothing is ever skipped — the strength rotation is a cursor, not a calendar.
- Week starts **Monday**; timezone is fixed to **Europe/Bratislava**.

### Recovery and self-regulation

- **Comeback mode**: after ≥ 10 days (configurable) without any session, Today *offers* (never auto-applies) a
  comeback: strength at 90 % of current weights (stages kept), cardio at 70 % of last week's volume, ramping
  back over two weeks.
- **Readiness check** (optional, skippable) before any session: sleep, energy, soreness, each 1–5. A total of
  ≤ 7 shows a suggestion ("consider skipping the AMRAP set" / "shorten to 70 % of target"). It never mutates
  program state; it is stored on the session for later correlation.
- **Deload week** is visible on Today and Plan so the user knows why the numbers dropped.

### Tracking and progress

- **Bodyweight**: quick add on Today; 7-day rolling average chart in Progress.
- **Progress** shows per-lift working weight and estimated 1RM over time, weekly cardio minutes against target,
  a PR list (weight, e1RM, AMRAP reps), bodyweight trend, and readiness vs. performance.
- **Personal records** are detected when a session is finished and shown in its summary.
- **JSON export** of all user data from Settings.

### Notifications

- FCM web push. A daily scheduled function (07:00 Europe/Bratislava) sends a "Today: …" summary on training
  days and a separate nudge when the gap since the last session reaches the comeback threshold.
- Both are toggleable per user. Permission is requested **from Settings only**, never on first launch.

### Onboarding and import

- A **resumable wizard** (progress stored on the profile): sign-in → gym setup (units, barbell, plates) →
  program → cardio baseline → zones (optional) → availability (with a live preview of the composed week) →
  review & start. Every step's form body is a component reused in Settings.
- Program step offers two equal paths: **Continue from Liftosaur** (paste program text, optionally the JSON
  history export; the app derives current weights, stages and rotation position onto an editable confirmation
  screen) or **Start fresh with GZCLP** (per lift: working weight and stage; "I don't know" computes from a 5RM;
  empty means "ask me at the first session").
- Unsupported Liftoscript constructs fail with diagnostics and a fallback offer: keep the detected weights, run
  the built-in GZCLP.
- **Skip setup** accepts defaults: GZCLP with all lifts as ask-weight, 2 × 30 min cardio baseline.

### UI and platform

- Mobile-first PWA, **light mode only** (bright gym, arm's length), one high-chroma accent, big numerals on
  session screens, ≥ 48 px tap targets, bottom navigation with five tabs: Today, Plan, Progress, History,
  Settings.
- Vue 3 + TypeScript + Vite + Tailwind 4 + vuiii; Firebase (Auth, Firestore, Functions, Hosting, FCM).
- Works offline for viewing and logging (Firestore persistent cache); Strava and notifications need a network.
- UI text is English.

### Accounts and privacy

- Allowlist in Firestore `config/allowlist`; security rules check it on every access and enforce per-document
  ownership.
- Strava tokens are readable and writable only by Cloud Functions.
- Users can export all their data as JSON. Account deletion is not in MVP (see Scope).

---

## Screens

| Route | View | Purpose |
|-------|------|---------|
| `/signin` | SignIn | Google button; "ask for access" state for non-allowlisted accounts |
| `/onboarding/:step` | Onboarding | Resumable wizard, steps 0–6 |
| `/` | Today | Today's card (strength day, cardio prescription, or rest); claim-today and swap controls; comeback proposal; deload badge; streak and week tiles; bodyweight quick add |
| *(from Today)* | StrengthSession | Tier blocks with tap-cycling set rows, AMRAP stepper, plate hints, rest timer, readiness sheet on entry, completion summary with progression lines and new PRs |
| *(from Today)* | CardioSession | Prescription card (zone as HR / pace / RPE cue) with manual log form; a matched Strava activity shows as completed |
| `/plan` | Plan | This week as composed: planned vs done per day, deload badge, placement explanations |
| `/progress` | Progress | Lift weight and e1RM lines, weekly cardio bars vs target, PR list, bodyweight trend, readiness vs performance |
| `/history` | History | Finished sessions; delete the most recent one (with confirmation) to restore program state |
| `/program` | Program | Program text editor with diagnostics, per-exercise current state, copy-out |
| `/settings` | Settings | All wizard form sections, rest timers, comeback threshold, Strava connect card, notification toggles, JSON export |

---

## Scope

### MVP (milestone 1)

- Allowlisted Google sign-in.
- Liftoscript engine for the documented subset, with diagnostics and a stable serializer.
- Built-in GZCLP; paste-your-own program; Liftosaur history import with derived state.
- Prescribed cardio with mesocycles, adaptive hold/step-back, zones, modality rotation.
- Availability-driven composer with interference rules, claim-today, swap-today.
- Today / StrengthSession / CardioSession / Plan / Progress / History / Program / Settings.
- Comeback mode, readiness check, bodyweight, PRs, JSON export.
- Strava OAuth + webhook import + 30-activity backfill; manual cardio entry.
- FCM daily summary and gap nudge.
- Installable PWA with offline viewing and logging.

### Milestone 2 (model ready, no UI in MVP)

- `race` cardio goal: race date and target time, base → build → peak → taper periodization, missed-workout
  classification and replanning — the core of the RunPlan Pro exploration.
- `numeric` strength goal: target weight for a lift with ETA projection from the current progression rate.
- Account deletion and a formal data-retention policy.
- Additional exercises in the built-in catalog; more Liftoscript constructs as real programs need them.

### Explicitly out of scope

- Public sign-up, social features, coach/athlete relationships, monetization.
- Native apps (the PWA is the product).
- Garmin / Apple Health / Polar integrations (Strava is the aggregator).
- Editing finished sessions; recomputing history after a program edit.
- Dark mode.
- AI-generated programming.

---

## Success criteria

runbo is a personal tool, so the criteria are about whether it removes the bookkeeping, not about growth:

| Criterion | Target |
|-----------|--------|
| Every strength session logged in runbo, not in Liftosaur | 100 % after the import |
| Weights, stages and resets never computed by hand | 0 manual corrections per month after the first month |
| Cardio sessions matched from Strava without manual fixing | ≥ 90 % of Strava activities auto-matched or correctly left unplanned |
| Cardio volume actually progresses | mesocycle advances (not held) in ≥ 3 of 4 cycles |
| Comeback and deload used when relevant | comeback proposal accepted after every ≥ 10-day gap |
| Time from opening the app to first set | < 10 s (session card on Today, one tap to start) |

---

## Risks and mitigations

- **Liftoscript compatibility.** Real Liftosaur programs use constructs outside our subset. *Mitigation:* every
  unsupported construct produces a precise diagnostic; the fallback keeps detected weights and runs the
  built-in GZCLP; the subset grows only when a real program needs it.
- **Composer produces a week the user will not follow.** *Mitigation:* the composer explains its placements;
  claim-today and swap-today give the user control without breaking the rotation; only future days recompose.
- **Strava matching errors.** *Mitigation:* dedup by activity id; an unmatched activity is still counted toward
  volume as an unplanned session; manual entry always works.
- **Losing history through a bad program edit.** *Mitigation:* history is read-only; program state snapshots
  on every session; only the last session can be deleted and it restores the snapshot.
- **Firebase costs.** Irrelevant at 1..n users; Firestore persistent cache keeps reads low regardless.
- **Single developer, no CI.** *Mitigation:* all domain logic is pure TypeScript with vitest coverage;
  phases have explicit acceptance checks (see the implementation spec).

---

## Relationship to RunPlan Pro

RunPlan Pro (the previous content of this file and of `runbo-implementation.md`) was a running-only,
goal-driven adaptive training app. In August 2026 it was merged with a separate GZCLP + cardio plan (working
names "fitko", then "sensei") into runbo.

**Kept and reshaped:** Strava OAuth and webhook flow, activity import, cardio periodization in mesocycles,
adaptive volume, HR/pace zones, mobile-first PWA on Vue + Firebase, push notifications, offline via Firestore
cache.

**Deferred to milestone 2:** race goals with date and target time, phase periodization (base/build/peak/taper),
missed-workout classification matrix, finish-time prediction (VDOT-style), performance scoring against pace
targets, plan-adjustment audit log.

**Dropped:** email/password registration and password reset (Google + allowlist instead), VueFire (hand-written
Firebase service layer), custom REST API for plans and workouts (Firestore directly; Functions only for Strava
and notifications), running-only scope, dark mode, CI/CD pipeline, Playwright E2E, transactional emails,
analytics events, public timeline and marketing metrics.

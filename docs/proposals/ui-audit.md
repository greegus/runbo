# UI audit: reusable components and unified patterns

_2026-11-04. Read-only review of `src/components`, `src/views` (onboarding included) and `src/style.css`. Paths below
are under `src/`._

## Summary

The app's screens were built one at a time, and each solved the same problems its own way. The result is not broken,
but the same job looks and behaves differently from screen to screen:

- **7 heading styles** for a section heading, **3 card radii**, **4 paddings** and **3 backgrounds** for the same
  kind of surface.
- **~35 inline notice panels** (info, error, blocked reason, offline) in a handful of near-identical recipes — and an
  error looks exactly like an info note.
- **5 disclosure implementations** (two animated, three that swap `chevron-up`/`chevron-down`, plus three styled
  `<details>`), **2 bottom sheets** with different scrims and animation, **2 month/week pagers** that differ.
- **5 ways to show a unit** on a number field, **~14 copies** of "finite number or null" coercion.
- **Green** used for "done" in three places where the rest of the app uses the accent (now decided — see the
  success colour rule).
- One real accessibility bug: **24 inputs are announced as "input"** (see P1).

Most of it collapses into about ten small components and a short list of rules. The backlog below is ordered by what
each item fixes per hour spent.

## Rules to adopt

These are decisions, not components — write them down once and the components follow from them.

| Topic | Rule |
| --- | --- |
| Tap targets | 48px for every control; 56px only for a screen's one primary action in a sticky bar. No 40px buttons (`TodayCard` sauna buttons are 40px today). |
| Primary action | vuiii `Button color="primary" size="large"`. Never a hand-rolled `<button>` for a plain CTA. |
| Destructive action | One recipe: `variant="text" color="secondary" prefix-icon="trash"`, centred under the content; the confirm uses one copy pattern ("Abandon this session?" / "Abandon session") everywhere. |
| Success colour | **Decided:** green (a `--color-success` token) confirms that something succeeded or is complete — a finished lift's tab check, "Logged" in a session header, a done day's check in the calendar, "Saved", Multisport once paid off. The accent stays the brand: actions, the active or current thing, and a logged set's fill. |
| Surfaces | Card = `rounded-xl border-ink-200 bg-white p-4`. Inset panel = `rounded-lg bg-ink-50 p-3`. Nothing else. |
| Section heading | Two variants only: *title* (`text-lg font-semibold text-ink-900`) and *eyebrow* (`text-sm font-semibold tracking-wide uppercase text-ink-500`). |
| Muted text | `text-ink-500` for secondary text; `ink-600` only for body copy on `bg-ink-50`; `ink-400` for icons/chevrons/skipped. |
| Units | Always the field's suffix (`InputUnit`). Never in the label, the hint, or a span beside the field. |
| Disclosure | `collapse-panel` + one rotating `collapse-chevron` + `inert` + `aria-controls`. No `v-if` swaps of two chevrons. |
| Overlays | vuiii's scrim colour + 4px blur; slide up on a phone, scale in from `sm`; Escape/backdrop/X = close. |
| z-index | `sticky 10 · toast 40 · overlay 50`, as tokens. |

## Backlog

### P1 — fix now (bugs and accessibility)

1. **24 inputs are read out as "input".** vuiii sets `aria-label = placeholder || "input"` on the inner `<input>`
   (`node_modules/vuiii/dist/vuiii.js:1351`), which overrides `FormGroup`'s `<label for>`. `CardioLogForm` works
   around it; these do not: `CardioForm` (2), `ProgramForm` (2), `ZonesForm` (10), `GymForm` (2), `DerivedStateTable`,
   `ImportPasteForm`, `SettingsView` (6). Fixed for good by **NumberField** (P2-3), which passes the label through.
2. **Busy state is invisible on hand-rolled buttons.** `ReadinessSheet`, `ComebackCard`, `TodayCard`, `TodayView`
   set only `aria-disabled`, and nothing dims `[aria-disabled]` buttons (`style.css`). Either move them to vuiii
   `Button` (P2-1) or add one global `[aria-disabled='true'] { opacity: .5 }`.
3. **Error and info look the same.** Every `role="alert"` box is the same grey panel as a status note. Fixed by
   **Notice** (P2-2) with a distinct error tone.
4. **Stale comment** `history/HistoryRow.vue:180` ("No trash icon is registered") — `trash` exists.

### P2 — components with the widest reach

| # | Component | Replaces | Reach |
| --- | --- | --- | --- |
| 1 | **Button rules → `AppButton` or a documented size/variant convention**; `TouchIconButton` baking in `size="large"` + 48px | hand-rolled CTAs in `ReadinessSheet`, `ComebackCard`, `TodayCard`, `TodayView`, `RestTimer`; 12 IconButton sites repeating `size="large" min-h-[48px] min-w-[48px]` | ~20 sites |
| 2 | **`Notice`** — `tone` neutral/info/warning/error/success, optional icon and title | ~35 inline panels: Progress, History, Plan, Program, StepShell, both session views, ExportDataCard, SignIn, CardioForm, GymForm, ProgramForm, ImportPaste/History, DerivedStateTable, ProgramStep, WeekPreview, ZonesForm, ReadinessSheet advice | ~35 |
| 3 | **`NumberField`** — FormGroup + Input + InputUnit + aria-label from the label + one number size | number fields in Zones, Cardio, Program, Gym, Settings, TierBlock, DerivedStateTable, ImportPaste, BodyweightQuickAdd | ~25 fields |
| 4 | **`src/utils/number.ts`** — `finiteOrNull`, `positiveOrNull`, `nonNegativeOrZero`, `clampWhole` | `numberOrNull` (ZonesForm), `toNumberOrNull` (TierBlock), `toOptionalNumber` (CardioLogForm), `toNumber` (GymForm), `toMinutes` (CardioForm), `whole` (AvailabilityForm) and ~8 inline copies | ~14 |
| 5 | **`Disclosure`** (trigger + rotating chevron + collapse panel) | ReplacePicker, TierBlock warmup, HistoryRow, DerivedStateTable, ImportHistoryForm, and the `<details>` in WeekPreview, ChartFigure, ExportDataCard | 8 |
| 6 | **`BottomSheet`** (teleport, scrim + blur, slide/scale, `useFocusTrap`, header + X) | `ReadinessSheet`, `ProjectionSheet` — which today differ in scrim, blur, mobile animation and focus trap | 2 |
| 7 | **`PageHeader`** + **`PageShell`** (`max-w-lg p-4 gap-4`) + **`StickyActionBar`** | h1 blocks in 6 tab views and StepShell; the sticky footer copied in StrengthSession, CardioSession, StepShell | ~10 |
| 8 | **`SectionHeading`** (`title` / `eyebrow`) | the 7 heading styles; also removes `h2` headings inside a Card that already has a title (GymForm, ZonesForm) | ~30 |
| 9 | **`Badge`** (accent / neutral) | "Deload week" (styled two ways: TodayCard vs WeekPreview), "In progress", tier tags, set chips — 5 pill recipes | ~8 |
| 10 | **`ListRow`** (icon, title, subtitle, trailing slot; button / link / div) | HistoryRow header, ReplacePicker rows, WeekPreview rows, DiagnosticsList rows | 4 lists |
| 11 | **`Pager`** (prev / title + sub-label / next, aria-labels, explained disabled end) | PlanView week stepper (`outlined`) vs MultisportUsage month stepper (`text`) | 2 |
| 12 | **`EmptyState`** and **`LoadingState`** (skeleton blocks + sr-only label) | 4 empty-state styles (Progress ×2, History, Plan, Strength); 3 "Loading…" styles + HistoryView's mismatched skeleton | ~12 |

### P3 — smaller unifications

- **`SectionSaveFooter` in `ProgramView`** (`:274-291` re-implements it: no alert icon, 56px button). Add a `label`
  prop for "Save program".
- **One stepper.** The AMRAP stepper in `SetRow` (`:198-250`) is three bordered boxes — exactly what `CountStepper`
  was built to replace. Give `CountStepper` a `size="large"` and use it there.
- **One 1–N scale control.** Readiness uses a 1–5 `RadioButtonGroup`, RPE a 1–10 `RangeSlider`. Pick one idiom (or
  document why they differ).
- **`PendingSyncNotice`** shared by both session views (`:632` vs `:412` — different copy and text size).
- **Not-found state** for sessions: Cardio has a heading and a button, Strength an icon and a line. One component.
- **Confirm copy** for abandoning a session differs between cardio and strength; History's delete is `outlined`
  where the session screens use `text`.
- **Tables**: Progress records, ProjectionSheet and ChartFigure use three table styles. One `DataTable` class set.
- **Link-styled buttons**: `TodayCard:189` and `TodayView:433` copy button classes onto `<router-link>`; use vuiii
  `Button :to` (as `ReviewStep` already does).
- **WeekdayPicker** is `rounded-md`; every other control is `rounded-lg`/`xl`.
- **Number typography**: two tokens — `metric-xl` (4–5xl bold) and `metric` (3xl semibold), always `tabular-nums`
  (`TodayCard` and `SetRow:137` lack it).

### Tokens to add in `style.css`

- Icon sizes: `--icon-size-xl: 1.5rem` (AppNav, BodyweightQuickAdd) and `--icon-size-hero: 1.9375rem` (TodayCard,
  SessionHeader) instead of four inline overrides.
- z-index scale: `--z-sticky: 10`, `--z-toast: 40`, `--z-overlay: 50`.
- `--app-nav-height`, replacing the hard-coded `5.5rem` offset in `UpdatePrompt`.
- `--color-success` (green-600, text green-700) for the success rule above; replace the raw `green-*` classes in
  `StrengthSessionView` (tab check), `BodyweightQuickAdd` (saved check) and `MultisportUsage`, and move the accent
  done marks in `WeekPreview`, `SessionHeader` and `SectionSaveFooter` ("Saved") onto it.
- Shared TabsNav classes (`scroll-px-4 px-4 [&_[role=tab]]:min-h-[48px]`, repeated in Settings and StrengthSession)
  into the global `.TabsNav` rule.

## Suggested order

1. P1 (half a day) — NumberField fixes the labels at the root, so start it here.
2. Notice, Button rules, number utils (P2-1…4) — the widest reach, least design debate.
3. Disclosure and BottomSheet (P2-5, 6) — both have a reference implementation already (`collapse-panel`,
   `ReadinessSheet`).
4. Page shell, headings, badges, list rows, pager, empty/loading states (P2-7…12).
5. P3 and the tokens, opportunistically, when a screen is touched anyway.

Each step is a commit series that changes no behaviour except where this audit names a fix; a screenshot pass at
360px after each step catches drift.

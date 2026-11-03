# Proposal: sauna on rest days

Status: proposed (November 2026). Not yet folded into `runbo-requirements.md` / `runbo-implementation.md`;
fold it in once the MVP below is accepted.

## What

The planner suggests a **sauna** on some rest days. A rest day stays a rest day: the Today card still reads
"Rest day", with a sauna suggestion under it, and the week calendar marks the same days.

## Decisions

### A suggestion, not a planned item

Sauna is **not** a `PlannedItem` and not a third track. It is derived from the composed week after the fact and
attached to rest days. That keeps every existing rule untouched:

- it never counts as a training day and never consumes `daysPerWeek` or `strengthDaysPerWeek`;
- the strength rotation, the cardio budget and the block/deload logic never see it;
- the streak, the weekly roll-up tiles, comeback detection and progression ignore it;
- swap / replace today work exactly as before — a rest day with a sauna suggestion is a rest day.

A third track would have to answer all of those questions, and every answer would be "ignore it".

### Which rest days

- **At most two per week.** Two to three sessions a week is where the usual sauna benefits are reported, and
  two is enough to make it a habit without crowding the plan.
- **Never two days in a row**, so the suggestions spread over the week.
- **The day after a training day first** — that is where a recovery session helps most and where it is most
  likely to be wanted. Among equals, earlier in the week first.
- **Only from today on.** A suggestion for a day that is already past is noise; past rest days stay plain.
- A day with any logged session is not a rest day, so it never gets one.

No interference rule with the next day's lifting: a sauna session on its own does not hurt next-day
strength enough to be worth a rule, and the athlete can ignore any suggestion.

### Display-only for now

The MVP does not log sauna. Logging would need a new `Session.kind`, a form, history rows, export handling and
a decision on whether it touches the streak — a milestone-2 question once it is clear the suggestion is used.

### A setting, on by default

`availability.saunaOnRestDays` (Schedule tab in Settings, "Suggest sauna on rest days"). Optional with no
migration, like `strengthDaysPerWeek`: an absent field means **on**, because the athlete asked for the feature
and an existing profile should get it without a save. Turning it off removes every suggestion.

It lives in `availability` rather than `settings` because it is about the shape of the week and is saved by the
same Schedule section.

### Where it shows

- **Today card**, rest branch: "Rest day" with a sauna line under it ("Sauna suggested — 15–20 min, easy heat,
  drink water").
- **Week calendar** (Plan and the onboarding preview): a rest row reads "Rest · sauna" with the sauna icon.
- **Not** in the replace picker: it is not a workout to move or owe.

### Data model and rules

- `Profile.availability.saunaOnRestDays?: boolean` — the only stored change.
- Firestore rules do not validate `availability` fields, so nothing changes there. The JSON export carries the
  profile as it is, so the field is exported with it.
- No new collection, no new session kind.

## MVP scope

1. `src/training/sauna.ts`: a pure `saunaDates(days, fromDate)` with tests.
2. `WeekGridDay.sauna` from `buildWeekGrid` (current week, from today on) and `TodayModel.saunaToday`.
3. Today card rest branch and calendar rest rows; the Settings toggle.

## Later

Logging a sauna session (minutes, optional temperature), a per-week count chosen by the athlete, and whether a
logged sauna belongs in the streak.

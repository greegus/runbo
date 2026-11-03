# Proposal: sauna

Status: proposed (November 2026). Not yet folded into `runbo-requirements.md` / `runbo-implementation.md`;
fold it in once the MVP below is accepted.

## What

Two things, both about a sauna that is **not training**:

1. **Claiming a sauna.** "Train something else today" always offers *Sauna*. One tap records a dated entry for
   today — mainly so there is a record that the Multisport card was used. Nothing else about the day changes.
2. **A rest-day suggestion** (opt-in). When switched on, the planner marks one rest day a week as a good day for
   a sauna; the Today card offers to claim it in one tap.

## Decisions

### A claimed sauna is a note on the day, never a training session

It is stored as a `Session` with `kind: 'sauna'`, `status: 'done'`, a `date` and optional `minutes` — the same
collection, rules and export path as every other entry, and one dated document per visit, which is exactly what a
later Multisport count per calendar month needs to read.

Every training consumer drops it first, through one helper (`trainingSessions` in `src/training/sauna.ts`):

- the planner and composer (`planWeek`): a day holding only a sauna is a rest day — it fills no slot, holds no
  fixed day, and the frontier frees it like any unlogged day;
- the strength rotation, the cardio budget, `daysPerWeek`, the cardio block ratio and deload;
- comeback and the gap since the last session: a sauna does not close a gap in training;
- the streak: a sauna neither extends nor keeps one alive — the streak counts training, and a claim takes one tap,
  so counting it would let the streak be kept without training;
- the weekly roll-up (sessions, minutes, tonnage) and every progress stat;
- the week calendar's status, title and link, and Today's `doneSession` / `activeSession`.

Tests cover the planner, comeback, streak, roll-up and calendar cases.

### Claiming on a training day: an addition

Picking *Sauna* never replaces today's workout. It is offered as "Claim it for today — in addition, today's plan
stays": the planned session is still there to start, and the claim sits beside it. Treating it as a replacement
would displace a workout for something that is not one, and the week would quietly lose a session. On a rest
day the day stays a rest day.

The option is permanent — every day, whatever the setting — and drops out of the picker once today has a claim.
The Today card shows "Sauna claimed" with an Undo, because one tap to claim should be one tap to take back.

### The rest-day suggestion

- **One a week** — a nudge towards a habit, not a second schedule.
- **The rest day right after a training day**, earlier in the week first; otherwise the earliest rest day.
- **Only from today on**; a missed workout does not count as training when choosing the day after one.
- **Not when a sauna is already claimed that week.**
- **Opt-in**: `cardioTrack.saunaOnRestDays`, a switch in Settings → Cardio beside the cardio it recovers from; off by
  default and off when absent. Switching it off drops the field
  rather than writing `false`, so an off → on → off round trip leaves no difference behind to read as unsaved.
- No interference rule with the next day's lifting: it is a suggestion the athlete can ignore.

### Where it shows

- **Today card**: "Sauna claimed" (with minutes when given) and Undo, on any day; on the suggested rest day,
  "Sauna suggested" with a one-tap Claim.
- **Week calendar**: a rest row reads "Rest · sauna claimed" (with the done mark) or "Rest · sauna suggested"; a
  training row with a claim gets a "Sauna claimed" line under it.
- **History**: a "Sauna" row with its minutes, marked "Not counted as training".
- **Replace picker**: the permanent *Sauna* option.

### Data model and rules

- `SessionKind` gains `'sauna'`; `TrainingKind` names the two that train.
- `Profile.cardioTrack.saunaOnRestDays?: boolean`.
- Firestore rules do not enumerate `kind` or validate `cardioTrack` fields, so they are unchanged. The JSON
  export carries sessions and the profile as stored.

## Later

- Minutes on a claim from the UI (the store already accepts them).
- The Multisport card setting: count gym sessions, swims and claimed saunas per calendar month against the card
  price. Saunas are dated `Session` documents of their own kind, so the count is a filter by kind and month.

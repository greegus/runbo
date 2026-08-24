# Reference docs — superseded

`runbo-product-reuirements.md` and `runbo-implementation.md` are the original "RunPlan Pro" exploration:
a running-only, goal-driven training app. They are kept for the cardio ideas worth harvesting — adaptive
replanning, missed-workout classification, Strava webhook flow, screen inspiration.

**They are superseded by the current implementation plan wherever they disagree.** Notably, the following
from those docs does *not* apply:

- email/password registration and password reset — runbo uses **Google sign-in + an email allowlist**
- VueFire — runbo uses a **hand-written Firebase service layer** (same pattern as the pubquiz project)
- a custom REST API for plans/workouts — runbo talks to **Firestore directly**, with Cloud Functions only for
  Strava OAuth/webhook and push notifications
- running-only scope — runbo covers **strength (GZCLP) + cardio** as two orthogonal tracks

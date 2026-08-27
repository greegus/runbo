# Docs

- `runbo-product-reuirements.md` — **what and why**: goal, users, settled product decisions, screens, scope
  (MVP vs milestone 2), success criteria, risks.
- `runbo-implementation.md` — **how**: stack, data model, Firestore rules, Liftoscript spec, training domain
  modules, Firebase layer, import, onboarding, views, Cloud Functions, PWA, testing, phases with acceptance
  criteria and current status.

Both are v2.0 (August 2026) and together form the single source of truth for runbo. They were rewritten from
the implementation brief that merged the original "RunPlan Pro" exploration (running-only, race-goal-driven)
with the GZCLP + cardio plan (working names "fitko" / "sensei"). Where the code and the docs disagree, fix one
of them in the same change.

The original RunPlan Pro PRD and implementation spec (v1.x, January 2026) are preserved in git history at
commit `e07ef1a`; the ideas kept from them and the ones deferred to milestone 2 are listed at the end of the
PRD.

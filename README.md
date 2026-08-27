# runbo

Personal athletic-development app: GZCLP strength training (programs written in Liftoscript, executed by our
own interpreter) combined with prescribed cardio (run / bike / swim), merged into one week by an
availability-driven calendar composer.

## Stack

Vue 3 + TypeScript + Vite + Tailwind 4 + [vuiii](https://greegus.github.io/vuiii/) + Pinia + vue-router,
Firebase (Auth / Firestore / Functions / Hosting / FCM).

## Scripts

```sh
npm run dev          # dev server
npm run test         # vitest
npm run type-check   # vue-tsc
npm run build        # type-check + build
npm run lint         # oxlint --fix
npm run format       # oxfmt
```

## Docs

`docs/runbo-product-reuirements.md` (what and why) and `docs/runbo-implementation.md` (how, phases, status) are
the single source of truth — see `docs/README.md`.

# `notes-android`

- Native Android client lives in `app/` and is built with Kotlin, Jetpack Compose, WorkManager, and Glance.
- The companion Node API lives in `server/` and owns access to `MARKETING_DB_URL` plus semantic embedding calls.
- Do not move Postgres access into the Android client; keep database credentials and `OPENAI_API_KEY` server-side only.
- Widget actions should remain home-screen first:
  - direct refresh/delete/mode changes can happen inside the widget
  - text entry flows must continue to use small overlay activities because Android widgets do not support editable text fields
- Repo scripts:
  - `pnpm --filter notes-android start` runs the companion API
  - `pnpm --filter notes-android build` validates the generated `@lib/db-marketing` notes contract, type-checks the companion API, then assembles the Android debug app

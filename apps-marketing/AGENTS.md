# `apps-marketing`

- `notes-next` and `notes-android` are sibling marketing clients for the same
  Notes product domain.
- `@lib/db-marketing` is the shared source of truth for that domain's database
  schema, app-facing Notes contracts, and shared server-side workflow logic.

## Relationship to `@lib/db-marketing`

- Keep Postgres access in `@lib/db-marketing`; do not duplicate SQL or schema
  assumptions inside app folders.
- Shared Notes request/response shapes live in
  `@lib/db-marketing/contracts/notes-app.ts` and the generated
  `@lib/db-marketing/generated/contracts/notes-app.json`.
- Shared Notes server workflows live in
  `@lib/db-marketing/services/notes-app.ts`.

## App boundaries

- `notes-next`
  - imports `@lib/db-marketing` types directly in the web app
  - uses `@lib/db-marketing/services/notes-app` in its API routes
- `notes-android`
  - native Kotlin client does not talk to Postgres directly
  - companion Node API in `notes-android/server/` uses
    `@lib/db-marketing/services/notes-app`
  - Android build validates its Kotlin models and JSON wiring against the
    generated Notes contract from `@lib/db-marketing`

## Change workflow

- If a Notes table or column change affects app behavior, update
  `@lib/db-marketing` first.
- Keep migrations, generated DB artifacts, generated Notes app contract, and
  shared service logic in sync.
- Expect both `notes-next` and `notes-android` builds to fail if the shared
  contract becomes incompatible with either app.

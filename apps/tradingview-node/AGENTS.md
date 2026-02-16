# TradingView Node Service

Express service that owns the TradingView strength API previously hosted in `market-view-next`.

## Endpoints

- `POST /api/v1/tradingview`: accepts TradingView text payload and writes strength data.
- `GET /api/v1/tradingview`: reads `strength_v1` rows with optional query filters.
- `GET /health`: basic liveness check.

## Testing

- **Framework**: Node.js built-in test runner (`node:test`) + supertest for HTTP assertions. No additional test framework.
- **Run**: `pnpm test` (or `pnpm --filter tradingview-node test` from repo root).
- **Setup**: `src/test/setup.ts` runs via `--import` before tests; sets `NEON_DATABASE_URL` placeholder so db module does not throw. `NODE_ENV=test` prevents the server from starting when importing `createApp` for tests.
- **Mock data**: `src/test/mockData.ts` exports `mockStrengthRows` (GET), `mockInvalidPostBody`, `mockValidPostBody`, `mockValidStrengthData`, `mockStrengthAddResult` (POST). Uses types from `src/types/strength.ts`.
- **Testability**: `createApp(options?)` accepts `getStrengthRows`, `strengthAdd`, `sqlLogAdd` overrides. `createGetTradingView(deps)` and `createPostTradingView(deps)` receive injected deps. POST tests use `noOpSqlLogAdd` to avoid DB/SMS during validation-error paths.

## Notes

- Keep route behavior compatible with prior Next.js API contract (`ok`, `status`, `rows`, `error`).
- Route handlers are split into `src/handlers/tradingview/` and mounted from `src/routes/tradingview.ts`.
- Strength parsing/read/write logic is centralized in `src/services/strength.ts`.
- Shared types and utilities are in `src/types/strength.ts` and `src/lib/*`.
- Invalid TradingView payloads and runtime handler failures should be logged via `sqlLogAdd` (`@lib/common/sql/log/add`) for observability.
- Import shared logging directly from `@lib/common/sql/log/add`; `@lib/common` is now ESM to support named exports in Node services.
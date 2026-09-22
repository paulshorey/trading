# Git hooks

`pre-push` runs `pnpm test` when pushing from `main`, if the hook is enabled locally.
Dependency installation does not configure hooks. Use `pnpm test` and `pnpm build`
from the repository root to validate code changes independently of hooks.

# Instructions for coding agents (Codex / opencode)

- Read `SPEC.md` first; it is the source of truth. If something is ambiguous, pick the simplest
  behavior consistent with the spec and note it in `NOTES.md`.
- TypeScript ESM, strict mode. Keep modules small: `src/db`, `src/workers`, `src/core` (tick, dispatch,
  finalize, review), `src/views`, `src/cli.ts`, `src/server.ts`, `src/scheduler.ts`.
- `npm test` (vitest) and `npm run typecheck` must pass before you finish.
- Tests must never invoke real `codex`, `opencode` or `claude`; use `AAM_FAKE_WORKER` and injectable runners.
- Never `git push`. Never commit `vendor/`, `.aam/`, `node_modules/`.
- Never pass task text through a shell string; write it to files and pass file paths.
- Do not edit `SPEC.md`, `AGENTS.md`, `CLAUDE.md`.
- Commit your work with clear messages when done.

# Overnight run: drill, GW smoke, install / restart / rollback

Nothing here overwrites the running manager. Install the upgrade from this worktree into a **separate
checkout**, point a **separate `AAM_HOME`** copy at it, and switch only when satisfied.

## 1. Drill (fake runners only, no quota)
    npm test -- tests/overnight-drill.test.ts
Covers: cloud quota 0 → opencode free → free 429 (scoped cooldown, no attempt consumed) → local ollama →
approve → cooldown expiry + quota refresh → cloud again; ticks afterwards create no duplicate runs and
change no task status.

## 2. Read-only GW smoke (separate process, no completions)
    AAM_GW_BASE_URL=http://127.0.0.1:4000/v1 AAM_GW_API_KEY=… node scripts/gw-health-smoke.mjs
Only `GET /models`. Exit 0 = models advertised, 1 = unusable response, 2 = unreachable. Model identity is
whatever the gateway advertises; quota/limits are `unknown` unless the gateway states them.

Result recorded 2026-10-19 (no key supplied): `/health/liveliness` → "I'm alive!" but unauthenticated
`GET /v1/models` → HTTP 500. Real model identity therefore **not verified**; rerun with the gateway key.

## 3. Install (isolated)
    git clone <manager repo> /path/aam-next && cd /path/aam-next && git checkout <this branch>
    npm ci && npm test && npm run typecheck
    cp -R "$AAM_HOME" "$AAM_HOME.next"          # DB copy; originals untouched
    AAM_HOME="$AAM_HOME.next" ./bin/aam tick    # dry run on the copy

## 4. Switch / restart
    ./bin/aam launchd uninstall                 # in the OLD checkout (stops heartbeat)
    AAM_HOME="$AAM_HOME" /path/aam-next/bin/aam launchd install --load

## 5. Rollback
    /path/aam-next/bin/aam launchd uninstall
    cd /path/aam-old && ./bin/aam launchd install --load
The DB schema is only additively migrated; if in doubt restore the backup copy of `$AAM_HOME`
(`cp -R "$AAM_HOME.bak" "$AAM_HOME"` made before step 4).

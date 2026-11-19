# AGENTS.md

Read this at the start of every session. SPEC.md is the source of truth for *what*; this file is *how*.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install (Node 22.8+) |
| `npm run dev` | compile the front end once, run the server with reload on http://localhost:3000 (in-memory store if no `DATABASE_URL`) |
| `npm test` | all tests + coverage; fails under 80 % lines/branches/functions |
| `npm run check:ac` | every `[AC-n]` in SPEC.md has a test whose title contains it |
| `npm run typecheck` | `tsc --noEmit` for server and front end |
| `npm run build` | compile server to `dist/`, front end to `public/js/` |
| `npm run migrate` / `npm run migrate:dev` | apply pending migrations (compiled / via tsx) |
| `npm run seed` | demo labs + admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` |
| `npm run mcp` | MCP server over stdio, acting as the user of `LAB_SESSION_TOKEN` |

Run `npm run typecheck && npm test && npm run check:ac` before saying a task is done.

## Layers (dependencies point down only)

1. `src/http/` and `src/mcp/` — transport. Parse input, resolve the user, call **one** service function, format the
   result. No business rules, no permission checks, no SQL, no model calls.
2. `src/services/` — every rule and every "may this user do this?" check. Throws `AppError` subclasses
   (`src/domain/errors.ts`) with a Bulgarian sentence for the user.
3. `src/repos/` — SQL only, parameterised (`$1`), behind the interfaces in `repos/types.ts`. The in-memory twin
   (`repos/memory.ts`) must keep the same contract, including unique constraints.
4. `src/model/` — the model provider behind `ModelClient`. Only `services/suggestions.ts` uses it.
5. `web/src/` — views are pure functions `state → SafeHtml`; only `web/src/main.ts` touches the DOM.

## Always

- Write the test first for a new rule; put the AC id in the test title (`'AC-12 …'`). Add new criteria to SPEC.md §10.
- Add an MCP tool only as a thin call to an existing service function; add its HTTP twin to the SPEC table.
- Change the schema only with a new numbered file `migrations/NNN_description.sql`; never edit an applied one.
- Render user-visible values through the `html` tag (escaping). Show errors as sentences, never raw JSON.
- Use design tokens (`var(--…)`) for colour, spacing, type and radius; add a token rather than a raw value.
- Every new screen goes through `renderRemote()` so it has loading, empty, error and success.
- Keep SPEC.md current in the same commit as the change it describes.

## Ask the human first

- Any change to authentication, session handling or account linking.
- Any new dependency.
- Anything that changes which user data is sent to the model provider (update SPEC.md §6).
- Deleting or rewriting a migration, or anything that would lose data.

## Never

- Commit a secret, a `.env` file, or a real token. Configuration is read from environment variables only.
- Put a permission check in a route handler or an MCP tool instead of the service.
- Let an MCP tool or a route run its own SQL.
- Call the real model or Google in tests; pass a fake client / fake fetch.
- Log request bodies, passwords, tokens or prompts.
- Give the MCP server an admin or bypass mode.

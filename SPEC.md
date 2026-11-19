# SPEC — Резервация на лаборатории (Lab booking)

Topic registered in My course: **Резервация на лаборатории** — студентите резервират лаборатория за даден час,
преподавателят одобрява резервацията, а календарът показва кои зали са свободни.

## 1. Goals

- A student sees, for a chosen day, which labs are free in each one-hour slot (08:00–20:00).
- A student requests a slot. The request is **pending** until a teacher who supervises that lab approves or rejects it.
- A student sees their own bookings and cancels their own upcoming ones.
- A teacher sees the pending requests for the labs they supervise and approves or rejects them.
- An admin adds labs and assigns supervising teachers to them.
- A student can describe what they need in words and get one concrete free slot suggested (the model feature).
- An AI agent can do the same things as one signed-in user through the project's own MCP server.

## 2. Non-goals

- No e-mail verification for local sign-up, no password reset, no e-mail notifications.
- No recurring bookings, no multi-hour bookings (book consecutive hours one by one).
- No booking of individual workstations; the whole lab is the unit.
- No admin UI for deleting labs or changing roles beyond "assign supervisor".
- No real-time updates; the calendar is reloaded after every change.

## 3. Constraints

- TypeScript everywhere. Node 22.8+. One runtime dependency: `pg`.
- Back end on `node:http` (no framework) so every line of the HTTP layer is ours to explain.
- PostgreSQL on Neon (free tier persists; Render's free disk does not). App on Render free web service.
- Front end: plain TypeScript compiled by `tsc` into `public/js`, served by the same server (same origin, so no CORS).
- Slots are one hour, start hours 8..19, days in Europe/Sofia, at most 30 days ahead.
- A student may hold at most **3** upcoming active (pending or approved) bookings.
- No secret in the repository. Configuration comes from environment variables (`.env.example` lists them).

## 4. Data model

| Table | What it is |
|---|---|
| `users` | id, e-mail (unique, case-insensitive), name, role (`student`/`teacher`/`admin`), password hash (nullable) |
| `user_identities` | (provider, subject) → user: a linked Google account |
| `sessions` | SHA-256 of the session token → user, expiry |
| `labs` | name, building, capacity, description |
| `lab_supervisors` | **many-to-many** users ↔ labs: which teachers approve which lab's bookings |
| `bookings` | lab, user, date, hour, purpose, status (`pending`/`approved`/`rejected`/`cancelled`), decided_by |

A partial unique index `(lab_id, date, hour) WHERE status IN ('pending','approved')` makes double booking impossible
even under concurrent requests. Every schema change is a numbered file in `migrations/` applied by `npm run migrate`.

## 5. Auth

- **Local:** e-mail + password; the password is stored as `scrypt$<salt>$<key>` (Node's built-in `crypto.scrypt`,
  random 16-byte salt, 64-byte key, constant-time compare). Wrong password and unknown e-mail give the same message,
  and an unknown e-mail still spends the time of a hash check.
- **Social:** Google, OAuth 2.0 authorization-code flow with a random `state` checked against an HttpOnly cookie.
  The server swaps the code for a token and reads `sub`, `email`, `email_verified` from Google's userinfo endpoint.
- **One person, one account:** a known `(google, sub)` signs straight in. Otherwise the Google account is linked to the
  user with the same e-mail **only if Google says `email_verified: true`**. An unverified e-mail is refused: it neither
  links nor creates an account.
- **Same session:** both paths call the same `startSession()` and end with the same HttpOnly, SameSite=Lax `sid`
  cookie (Secure on HTTPS). Only the token's SHA-256 is stored. Sessions last 14 days; logout deletes the row.
- **Authorization lives in the service layer** (`src/services/*.ts`), never in a route handler:
  only the owner cancels a booking; only a supervisor of that lab (or an admin) approves/rejects; only an admin
  creates labs or assigns supervisors.
- **Known limitation:** because local sign-up does not verify e-mail, someone could register a password account with
  another person's address before that person ever signs in with Google; the later Google sign-in would link into it.
  The fix (verify e-mail at sign-up) is listed as a non-goal for this course project.
- CSRF: SameSite=Lax cookies plus "every non-GET API call must be `application/json`" (a cross-site form cannot send
  JSON without a CORS preflight, and the server never answers preflights).

## 6. The model feature — "Опиши от какво имаш нужда"

The student types e.g. „тиха зала за 3 души следобед, трябват ми осцилоскопи“ and picks a day.
The app replies with **one** free slot (lab + hour) and a one-sentence reason, and a button to book it.

- **Model:** Google Gemini (`gemini-2.5-flash` by default, `GEMINI_MODEL` to change), called over its REST API.
  **Why:** the account already exists from the setup guide, the free tier is enough for a class, it is fast, and it
  can be asked for JSON output (`responseMimeType: application/json`). Text is all this feature needs.
- **Outside the HTTP layer:** `src/model/client.ts` (the `ModelClient` interface + `GeminiClient`) and
  `src/services/suggestions.ts`. The route only calls `suggestions.suggest()`.
- **Timeout:** `MODEL_TIMEOUT_MS` (default 8 s) via `AbortController`; the service stops waiting even if the client ignores the signal.
- **Fallback:** with no key, an HTTP error (429 rate limit, 5xx), a timeout, or an answer that fails validation,
  a rule-based picker answers instead (reads "N души", an hour like "14 ч", or morning/noon/afternoon/evening;
  picks the smallest lab that fits, nearest to the wanted time). The UI says which one answered.
- **Validation:** the model only chooses from the free slots we send it; its JSON is parsed defensively and the pick is
  returned only if `(labId, hour)` is one of those free slots. The reason is trimmed to 200 characters and rendered
  escaped. Booking the suggestion goes through `BookingService.create`, which checks the slot again.
- **Tests:** a fake `ModelClient` (and a fake `fetch` for `GeminiClient`); the real model is never called in tests.
- **What data leaves the app:** the text the student typed, the chosen date, and the labs' names, buildings,
  capacities, descriptions and free hours are sent to Google's Gemini API. The student's name, e-mail and id are
  **not** sent. The prompt is never logged: on failure only the error kind is logged. Users should not type personal
  data into the box; the UI example shows the kind of text expected.

## 7. MCP server

`npm run mcp` starts the server over stdio. The protocol loop (`src/mcp/protocol.ts`) is the hand-written JSON-RPC
loop from Exercise 1; its tools were rewired from the lectures file to this project's data (`src/mcp/tools.ts`).

| Tool | Calls the same service as |
|---|---|
| `list_labs` | `GET /api/labs` → `labs.listLabs()` |
| `list_free_slots` | `GET /api/availability` → `labs.availability()` |
| `my_bookings` | `GET /api/bookings/mine` → `bookings.listMine()` |
| `book_slot` | `POST /api/bookings` → `bookings.create()` |
| `cancel_booking` | `POST /api/bookings/:id/cancel` → `bookings.cancel()` |
| `suggest_slot` | `POST /api/suggestions` → `suggestions.suggest()` |
| `pending_approvals` | `GET /api/bookings/pending` → `bookings.listPending()` |
| `approve_booking` | `POST /api/bookings/:id/approve` → `bookings.approve()` |
| `reject_booking` | `POST /api/bookings/:id/reject` → `bookings.reject()` |

The server acts as **one user**: `LAB_SESSION_TOKEN` holds an ordinary session token, created on the
„Моите резервации“ screen (`POST /api/auth/tokens`). Each call resolves the user from it with `auth.userForToken()`;
there is no admin key and no code path that skips the services.

## 8. UI

- Screens: Вход/Регистрация, Календар (with the suggestion panel), Моите резервации, За одобрение (teachers),
  Администрация (admin). Hash routing (`#/calendar`), one HTML page.
- Design tokens in `public/styles/tokens.css` (colour, spacing, type, radius); `app.css` uses only `var(--…)`.
- Layout is a single column of cards; hour chips wrap (`flex-wrap`), so there is no horizontal scrolling at
  380, 768 or 1280 px. Two-column admin forms from 768 px.
- Every data screen renders through `renderRemote()` → loading, empty, error (a sentence + "Опитай пак"), success.
- Keyboard: every action is a native `<button>`, `<a>` or form; visible `:focus-visible` outline (3 px, amber);
  skip link; focus is kept across re-renders and moved to the form/result after an action.
- Contrast: every text/background token pair ≥ 4.5:1, measured by `test/ui.test.ts`, which implements the
  WCAG 2.1 relative-luminance formula, and cross-checked with the WebAIM Contrast Checker.
- The suggestion panel shows a spinner and „Моделът мисли…“ while waiting, and a visible notice when the
  rule-based fallback answered because the model failed.

## 9. Architecture note

```
browser (public/, web/src) ──HTTP/JSON──▶ src/http/app.ts ──▶ src/services/* ──▶ src/repos/* ──▶ PostgreSQL
MCP client ──stdio JSON-RPC──▶ src/mcp/* ───────────────────────┘          │
                                         src/model/client.ts ◀────────────┘ (suggestions only) ──▶ Gemini
```

- **HTTP layer** (`src/http`): parse request, resolve user from the session, call one service, map `AppError` to a status.
- **Service layer** (`src/services`): every rule and every permission check. Shared by HTTP and MCP.
- **Repositories** (`src/repos`): SQL only, behind interfaces; an in-memory twin with the same contract is used by
  tests and by local runs without `DATABASE_URL`.
- Dependencies point one way: http/mcp → services → repos/model. Services never import from http.

## 10. Acceptance criteria

Each id appears in the title of at least one test (`npm run check:ac` verifies it).

### Sign-in
- [AC-1] Registering with an e-mail and a password creates a student account and stores only a scrypt hash of the password.
- [AC-2] A wrong password and an unknown e-mail are both refused with 401 and the same message.
- [AC-3] Google sign-in with a verified e-mail that matches an existing account signs into that same account and links it.
- [AC-4] Google sign-in with an unverified e-mail is refused and neither links nor creates an account.
- [AC-5] Both sign-in paths end in the same kind of session: the `sid` cookie works for `/api/auth/me`, and logout ends it.
- [AC-6] Registering an e-mail that already has an account is refused with 409.

### Calendar and bookings
- [AC-7] The calendar for a day lists every lab and every hour 08–19 as free, pending, approved or past, without showing who booked.
- [AC-8] Booking a free slot creates a pending booking.
- [AC-9] Booking a slot that is pending or approved is refused with 409.
- [AC-10] A fourth upcoming active booking is refused with 409.
- [AC-11] A slot in the past, an hour outside 08–19, or a day more than 30 days ahead is refused with 400.
- [AC-12] Only the owner may cancel a booking; anyone else gets 403.
- [AC-13] Only a teacher who supervises the lab, or an admin, may approve or reject; others get 403.
- [AC-14] Only a pending booking can be approved or rejected; deciding it again is refused with 409.
- [AC-15] A rejected or cancelled booking frees its slot.
- [AC-16] Only an admin may create labs and assign supervisors; assigning a student makes them a teacher.

### Model feature
- [AC-17] The model's pick is shown only if it is one of the free slots; an invented lab or hour, or invalid JSON, falls back.
- [AC-18] With no API key, a provider error or a timeout, the suggestion still answers through the fallback.
- [AC-19] The model call is aborted after the configured timeout.
- [AC-20] The prompt contains the request and lab data but not the user's name or e-mail.

### MCP server
- [AC-21] `tools/list` returns nine tools, each with a description of at least 20 characters.
- [AC-22] MCP tools apply the same rules as HTTP: cancelling someone else's booking and exceeding the limit are refused.
- [AC-23] Without a valid session token, every tool call is refused.

### UI
- [AC-24] Every data screen renders a loading, an empty, an error and a success state, and the error is a readable sentence.
- [AC-25] Every text/background token pair has a contrast of at least 4.5:1, and `app.css` uses only tokens.
- [AC-26] The suggestion panel shows that it is working, and shows when the model failed and the fallback answered.

### Platform
- [AC-27] Migrations apply in numeric order, each exactly once.
- [AC-28] API errors are `{ "error": "<sentence>" }`; unexpected errors become a generic 500; non-JSON writes get 415.
- [AC-29] No secret-shaped string (API key, client secret, private key) is committed to the repository.

## 11. Tests and coverage

`npm test` runs every test with Node's built-in runner and reports line, branch and function coverage for
`src/**` and `web/src/**`; it fails below 80 % on any of the three. Note: Node's coverage reports the files the
tests load. The entry points that only start a process (`src/main.ts`, `src/mcp/main.ts`, `src/db/migrate.ts`,
`src/seed.ts`), the `pg` pool factory (`src/db/pool.ts`) and the DOM glue `web/src/main.ts` are not loaded by
tests; everything they call is.

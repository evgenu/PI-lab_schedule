# Резервация на лаборатории

Студентите резервират лаборатория за час, отговорният преподавател одобрява, календарът показва кое е свободно.
TypeScript, Node 22, PostgreSQL. What and why: [SPEC.md](SPEC.md). How to work on it: [AGENTS.md](AGENTS.md).

## Run locally

```bash
npm install
cp .env.example .env        # fill in what you have; everything is optional locally
npm run dev                 # http://localhost:3000
```

Without `DATABASE_URL` the app uses an in-memory store with four demo labs. Set `ADMIN_EMAIL` and
`ADMIN_PASSWORD` to get an admin account. Without `GEMINI_API_KEY` the suggestions use the rule-based fallback.

With a database:

```bash
npm run migrate:dev && npm run seed:dev && npm run dev
```

## Test

```bash
npm test            # tests + coverage (fails under 80 %)
npm run check:ac    # every acceptance criterion in SPEC.md has a test
npm run typecheck
```

## Deploy (Render + Neon)

1. Create a Neon project and copy its connection string.
2. On Render: New → Blueprint → this repository (`render.yaml`). Enter `BASE_URL`, `DATABASE_URL`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY` in the dashboard.
3. In Google Cloud Console → OAuth client (Testing mode, yourself as test user), add the redirect URI
   `https://<your-app>.onrender.com/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback`).
4. Once, from your machine or a Render shell: `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed`.

## MCP

Sign in, open „Моите резервации“ → „Създай токен“, then add to your MCP client:

```json
{
  "mcpServers": {
    "lab-booking": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/path/to/lab-booking",
      "env": { "DATABASE_URL": "…", "LAB_SESSION_TOKEN": "…" }
    }
  }
}
```

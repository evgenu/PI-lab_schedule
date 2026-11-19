-- People who can sign in. One person = one row, however many ways they sign in.
CREATE TABLE users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'student'
                CHECK (role IN ('student', 'teacher', 'admin')),
  -- scrypt hash "scrypt$<salt>$<key>"; NULL for provider-only accounts.
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E-mail is the linking key, so it must be unique regardless of letter case.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

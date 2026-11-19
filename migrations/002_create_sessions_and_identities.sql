-- A session is created by either sign-in path. Only a SHA-256 of the token is
-- stored, so a leaked table does not let anyone sign in.
CREATE TABLE sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id ON sessions (user_id);

-- Social sign-ins linked to a user: (google, <sub>) -> user.
CREATE TABLE user_identities (
  provider   TEXT        NOT NULL,
  subject    TEXT        NOT NULL,
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

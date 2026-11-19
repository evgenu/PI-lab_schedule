CREATE TABLE labs (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  building    TEXT    NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  description TEXT    NOT NULL DEFAULT ''
);

-- The many-to-many relation: a teacher may supervise several labs, and a lab
-- may have several supervising teachers. Supervisors approve its bookings.
CREATE TABLE lab_supervisors (
  lab_id  INTEGER NOT NULL REFERENCES labs (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (lab_id, user_id)
);

CREATE INDEX lab_supervisors_user_id ON lab_supervisors (user_id);

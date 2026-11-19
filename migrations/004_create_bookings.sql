CREATE TABLE bookings (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lab_id     INTEGER     NOT NULL REFERENCES labs (id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  hour       SMALLINT    NOT NULL CHECK (hour BETWEEN 8 AND 19),
  purpose    TEXT        NOT NULL DEFAULT '' CHECK (length(purpose) <= 200),
  status     TEXT        NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by INTEGER     REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The database, not the service, is the last word on double booking: two
-- requests for the same slot at the same moment cannot both succeed.
-- Rejected and cancelled bookings do not hold the slot.
CREATE UNIQUE INDEX bookings_one_active_per_slot
  ON bookings (lab_id, date, hour)
  WHERE status IN ('pending', 'approved');

CREATE INDEX bookings_user_date ON bookings (user_id, date);
CREATE INDEX bookings_date ON bookings (date);

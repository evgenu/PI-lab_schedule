import { ConflictError } from '../domain/errors.js';
import type { Booking, BookingStatus, Lab, Role, User } from '../domain/types.js';
import type {
  BookingRepo,
  LabRepo,
  NewBooking,
  NewLab,
  NewUser,
  Repos,
  SessionRepo,
  UserRepo,
} from './types.js';

/** Anything that can run a parameterised query: a pg Pool, a client, or a test double. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

// Every query uses $1, $2 placeholders; no value is ever pasted into SQL text.

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === UNIQUE_VIOLATION;
}

export function createPostgresRepos(db: Queryable): Repos {
  return {
    users: new PgUserRepo(db),
    sessions: new PgSessionRepo(db),
    labs: new PgLabRepo(db),
    bookings: new PgBookingRepo(db),
  };
}

const USER_COLUMNS = 'id, email, name, role, password_hash, created_at';

function toUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export class PgUserRepo implements UserRepo {
  constructor(private readonly db: Queryable) {}

  async findById(id: number) {
    const { rows } = await this.db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string) {
    const { rows } = await this.db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async create(user: NewUser) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO users (email, name, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
        [user.email, user.name, user.passwordHash, user.role ?? 'student'],
      );
      return toUser(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Вече има профил с този имейл.');
      throw error;
    }
  }

  async setRole(id: number, role: Role) {
    await this.db.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
  }

  async findByIdentity(provider: string, subject: string) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.email, u.name, u.role, u.password_hash, u.created_at
         FROM user_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = $1 AND i.subject = $2`,
      [provider, subject],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async linkIdentity(userId: number, provider: string, subject: string) {
    await this.db.query(
      `INSERT INTO user_identities (provider, subject, user_id) VALUES ($1, $2, $3)
       ON CONFLICT (provider, subject) DO NOTHING`,
      [provider, subject, userId],
    );
  }
}

export class PgSessionRepo implements SessionRepo {
  constructor(private readonly db: Queryable) {}

  async create(tokenHash: string, userId: number, expiresAt: Date) {
    await this.db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash,
      userId,
      expiresAt,
    ]);
  }

  async findUserId(tokenHash: string, now: Date) {
    const { rows } = await this.db.query(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2',
      [tokenHash, now],
    );
    return rows[0] ? (rows[0].user_id as number) : null;
  }

  async delete(tokenHash: string) {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
}

export class PgLabRepo implements LabRepo {
  constructor(private readonly db: Queryable) {}

  async list() {
    const { rows } = await this.db.query(
      'SELECT id, name, building, capacity, description FROM labs ORDER BY name',
    );
    return rows as Lab[];
  }

  async findById(id: number) {
    const { rows } = await this.db.query(
      'SELECT id, name, building, capacity, description FROM labs WHERE id = $1',
      [id],
    );
    return (rows[0] as Lab | undefined) ?? null;
  }

  async create(lab: NewLab) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO labs (name, building, capacity, description) VALUES ($1, $2, $3, $4)
         RETURNING id, name, building, capacity, description`,
        [lab.name, lab.building, lab.capacity, lab.description],
      );
      return rows[0] as Lab;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Вече има лаборатория с това име.');
      throw error;
    }
  }

  async addSupervisor(labId: number, userId: number) {
    await this.db.query(
      'INSERT INTO lab_supervisors (lab_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [labId, userId],
    );
  }

  async isSupervisor(labId: number, userId: number) {
    const { rows } = await this.db.query(
      'SELECT 1 FROM lab_supervisors WHERE lab_id = $1 AND user_id = $2',
      [labId, userId],
    );
    return rows.length > 0;
  }

  async supervisedLabIds(userId: number) {
    const { rows } = await this.db.query('SELECT lab_id FROM lab_supervisors WHERE user_id = $1', [userId]);
    return rows.map((r) => r.lab_id as number);
  }
}

const BOOKING_COLUMNS =
  'id, lab_id, user_id, date, hour, purpose, status, decided_by, created_at';

function toBooking(row: any): Booking {
  return {
    id: row.id,
    labId: row.lab_id,
    userId: row.user_id,
    date: row.date,
    hour: row.hour,
    purpose: row.purpose,
    status: row.status as BookingStatus,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
  };
}

export class PgBookingRepo implements BookingRepo {
  constructor(private readonly db: Queryable) {}

  async create(booking: NewBooking) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO bookings (lab_id, user_id, date, hour, purpose)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${BOOKING_COLUMNS}`,
        [booking.labId, booking.userId, booking.date, booking.hour, booking.purpose],
      );
      return toBooking(rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('Този час вече е зает.');
      throw error;
    }
  }

  async findById(id: number) {
    const { rows } = await this.db.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1`, [id]);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  async listByUser(userId: number) {
    const { rows } = await this.db.query(
      `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE user_id = $1 ORDER BY date, hour`,
      [userId],
    );
    return rows.map(toBooking);
  }

  async listActiveOnDate(date: string) {
    const { rows } = await this.db.query(
      `SELECT ${BOOKING_COLUMNS} FROM bookings
        WHERE date = $1 AND status IN ('pending', 'approved')`,
      [date],
    );
    return rows.map(toBooking);
  }

  async listPending(labIds: number[] | 'all') {
    const { rows } =
      labIds === 'all'
        ? await this.db.query(
            `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE status = 'pending' ORDER BY date, hour`,
          )
        : await this.db.query(
            `SELECT ${BOOKING_COLUMNS} FROM bookings
              WHERE status = 'pending' AND lab_id = ANY($1::int[]) ORDER BY date, hour`,
            [labIds],
          );
    return rows.map(toBooking);
  }

  async countUpcomingActive(userId: number, date: string, hour: number) {
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n FROM bookings
        WHERE user_id = $1 AND status IN ('pending', 'approved')
          AND (date > $2::date OR (date = $2::date AND hour > $3))`,
      [userId, date, hour],
    );
    return rows[0].n as number;
  }

  async setStatus(id: number, status: BookingStatus, decidedBy: number, from: readonly BookingStatus[]) {
    // The status check is in the WHERE clause, so check-and-change is one statement.
    const { rows } = await this.db.query(
      `UPDATE bookings SET status = $2, decided_by = $3, updated_at = now()
        WHERE id = $1 AND status = ANY($4::text[])
      RETURNING ${BOOKING_COLUMNS}`,
      [id, status, decidedBy, [...from]],
    );
    return rows[0] ? toBooking(rows[0]) : null;
  }
}

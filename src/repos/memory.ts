import { ConflictError } from '../domain/errors.js';
import { isActive, type Booking, type Lab, type User } from '../domain/types.js';
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

/**
 * In-memory repositories with the same contract as the Postgres ones,
 * including the unique constraints. Used by the tests and by local runs
 * without DATABASE_URL. Never used in production.
 */
export function createMemoryRepos(): Repos {
  return {
    users: new MemoryUserRepo(),
    sessions: new MemorySessionRepo(),
    labs: new MemoryLabRepo(),
    bookings: new MemoryBookingRepo(),
  };
}

const clone = <T>(value: T): T => structuredClone(value);

class MemoryUserRepo implements UserRepo {
  private users: User[] = [];
  private identities = new Map<string, number>();
  private nextId = 1;

  async findById(id: number) {
    const user = this.users.find((u) => u.id === id);
    return user ? clone(user) : null;
  }

  async findByEmail(email: string) {
    const user = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return user ? clone(user) : null;
  }

  async create(input: NewUser) {
    if (await this.findByEmail(input.email)) throw new ConflictError('Вече има профил с този имейл.');
    const user: User = {
      id: this.nextId++,
      email: input.email,
      name: input.name,
      role: input.role ?? 'student',
      passwordHash: input.passwordHash,
      createdAt: new Date(),
    };
    this.users.push(user);
    return clone(user);
  }

  async setRole(id: number, role: User['role']) {
    const user = this.users.find((u) => u.id === id);
    if (user) user.role = role;
  }

  async findByIdentity(provider: string, subject: string) {
    const userId = this.identities.get(`${provider}:${subject}`);
    return userId === undefined ? null : this.findById(userId);
  }

  async linkIdentity(userId: number, provider: string, subject: string) {
    this.identities.set(`${provider}:${subject}`, userId);
  }
}

class MemorySessionRepo implements SessionRepo {
  private sessions = new Map<string, { userId: number; expiresAt: Date }>();

  async create(tokenHash: string, userId: number, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async findUserId(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session.userId : null;
  }

  async delete(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

class MemoryLabRepo implements LabRepo {
  private labs: Lab[] = [];
  private supervisors = new Set<string>();
  private nextId = 1;

  async list() {
    return clone([...this.labs].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async findById(id: number) {
    const lab = this.labs.find((l) => l.id === id);
    return lab ? clone(lab) : null;
  }

  async create(input: NewLab) {
    if (this.labs.some((l) => l.name === input.name)) {
      throw new ConflictError('Вече има лаборатория с това име.');
    }
    const lab: Lab = { id: this.nextId++, ...input };
    this.labs.push(lab);
    return clone(lab);
  }

  async addSupervisor(labId: number, userId: number) {
    this.supervisors.add(`${labId}:${userId}`);
  }

  async isSupervisor(labId: number, userId: number) {
    return this.supervisors.has(`${labId}:${userId}`);
  }

  async supervisedLabIds(userId: number) {
    return [...this.supervisors]
      .map((key) => key.split(':').map(Number) as [number, number])
      .filter(([, u]) => u === userId)
      .map(([labId]) => labId);
  }
}

class MemoryBookingRepo implements BookingRepo {
  private bookings: Booking[] = [];
  private nextId = 1;

  async create(input: NewBooking) {
    const taken = this.bookings.some(
      (b) => b.labId === input.labId && b.date === input.date && b.hour === input.hour && isActive(b.status),
    );
    if (taken) throw new ConflictError('Този час вече е зает.');
    const booking: Booking = {
      id: this.nextId++,
      ...input,
      status: 'pending',
      decidedBy: null,
      createdAt: new Date(),
    };
    this.bookings.push(booking);
    return clone(booking);
  }

  async findById(id: number) {
    const booking = this.bookings.find((b) => b.id === id);
    return booking ? clone(booking) : null;
  }

  async listByUser(userId: number) {
    return clone(sortBySlot(this.bookings.filter((b) => b.userId === userId)));
  }

  async listActiveOnDate(date: string) {
    return clone(this.bookings.filter((b) => b.date === date && isActive(b.status)));
  }

  async listPending(labIds: number[] | 'all') {
    return clone(
      sortBySlot(
        this.bookings.filter(
          (b) => b.status === 'pending' && (labIds === 'all' || labIds.includes(b.labId)),
        ),
      ),
    );
  }

  async countUpcomingActive(userId: number, date: string, hour: number) {
    return this.bookings.filter(
      (b) =>
        b.userId === userId &&
        isActive(b.status) &&
        (b.date > date || (b.date === date && b.hour > hour)),
    ).length;
  }

  async setStatus(id: number, status: Booking['status'], decidedBy: number, from: readonly Booking['status'][]) {
    const booking = this.bookings.find((b) => b.id === id);
    if (!booking || !from.includes(booking.status)) return null;
    booking.status = status;
    booking.decidedBy = decidedBy;
    return clone(booking);
  }
}

function sortBySlot(bookings: Booking[]): Booking[] {
  return [...bookings].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

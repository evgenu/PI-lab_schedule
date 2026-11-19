import type { Booking, BookingStatus, Lab, Role, User } from '../domain/types.js';

/**
 * Repositories only store and fetch. They hold no business rules except the
 * ones the database itself enforces (unique e-mail, one active booking per slot),
 * which they report as ConflictError.
 */

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string | null;
  role?: Role;
}

export interface UserRepo {
  findById(id: number): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: NewUser): Promise<User>;
  setRole(id: number, role: Role): Promise<void>;
  findByIdentity(provider: string, subject: string): Promise<User | null>;
  linkIdentity(userId: number, provider: string, subject: string): Promise<void>;
}

export interface SessionRepo {
  create(tokenHash: string, userId: number, expiresAt: Date): Promise<void>;
  findUserId(tokenHash: string, now: Date): Promise<number | null>;
  delete(tokenHash: string): Promise<void>;
}

export interface NewLab {
  name: string;
  building: string;
  capacity: number;
  description: string;
}

export interface LabRepo {
  list(): Promise<Lab[]>;
  findById(id: number): Promise<Lab | null>;
  create(lab: NewLab): Promise<Lab>;
  addSupervisor(labId: number, userId: number): Promise<void>;
  isSupervisor(labId: number, userId: number): Promise<boolean>;
  supervisedLabIds(userId: number): Promise<number[]>;
}

export interface NewBooking {
  labId: number;
  userId: number;
  date: string;
  hour: number;
  purpose: string;
}

export interface BookingRepo {
  /** Throws ConflictError when the slot already has a pending or approved booking. */
  create(booking: NewBooking): Promise<Booking>;
  findById(id: number): Promise<Booking | null>;
  listByUser(userId: number): Promise<Booking[]>;
  listActiveOnDate(date: string): Promise<Booking[]>;
  /** Pending bookings in the given labs; 'all' for every lab. */
  listPending(labIds: number[] | 'all'): Promise<Booking[]>;
  /** Active bookings of a user that start after (date, hour). */
  countUpcomingActive(userId: number, date: string, hour: number): Promise<number>;
  /**
   * Changes the status only if the current one is in `from`, in one atomic step,
   * so two teachers clicking "approve" at once cannot both win.
   * Returns null when the booking was not in an expected status.
   */
  setStatus(
    id: number,
    status: BookingStatus,
    decidedBy: number,
    from: readonly BookingStatus[],
  ): Promise<Booking | null>;
}

export interface Repos {
  users: UserRepo;
  sessions: SessionRepo;
  labs: LabRepo;
  bookings: BookingRepo;
}

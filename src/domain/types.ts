export type Role = 'student' | 'teacher' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** null for accounts that only ever signed in through a provider. */
  passwordHash: string | null;
  createdAt: Date;
}

/** What may leave the server about a user. Never includes the password hash. */
export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export interface Lab {
  id: number;
  name: string;
  building: string;
  capacity: number;
  description: string;
}

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** A booking in one of these states holds its slot; the others free it. */
export const ACTIVE_STATUSES: readonly BookingStatus[] = ['pending', 'approved'];

export function isActive(status: BookingStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export interface Booking {
  id: number;
  labId: number;
  userId: number;
  /** Calendar day in Europe/Sofia, YYYY-MM-DD. */
  date: string;
  /** Start hour of a one-hour slot, 8..19. */
  hour: number;
  purpose: string;
  status: BookingStatus;
  decidedBy: number | null;
  createdAt: Date;
}

/** A booking as the UI and the MCP tools see it: with the lab's name attached. */
export interface BookingView extends Booking {
  labName: string;
}

/** Another user's booking is shown only as a state, never with their identity. */
export type SlotState = 'free' | 'pending' | 'approved' | 'past';

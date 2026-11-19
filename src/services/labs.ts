import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { HOURS, isSlotInPast, isValidDate } from '../domain/time.js';
import type { Lab, SlotState, User } from '../domain/types.js';
import type { BookingRepo, LabRepo, UserRepo } from '../repos/types.js';
import type { Clock } from './auth.js';

export interface LabDay {
  lab: Lab;
  slots: { hour: number; state: SlotState }[];
}

export interface Availability {
  date: string;
  hours: readonly number[];
  labs: LabDay[];
}

export interface FreeSlot {
  lab: Lab;
  date: string;
  hour: number;
}

export class LabService {
  constructor(
    private readonly labs: LabRepo,
    private readonly bookings: BookingRepo,
    private readonly users: UserRepo,
    private readonly clock: Clock = () => new Date(),
  ) {}

  listLabs(): Promise<Lab[]> {
    return this.labs.list();
  }

  /**
   * The calendar: every lab, every hour, as a state. It deliberately says
   * nothing about who holds a slot.
   */
  async availability(date: unknown): Promise<Availability> {
    if (!isValidDate(date)) throw new ValidationError('Избери валидна дата.');
    const [labs, active] = await Promise.all([this.labs.list(), this.bookings.listActiveOnDate(date)]);
    const now = this.clock();
    return {
      date,
      hours: HOURS,
      labs: labs.map((lab) => ({
        lab,
        slots: HOURS.map((hour) => {
          const booking = active.find((b) => b.labId === lab.id && b.hour === hour);
          const state: SlotState = isSlotInPast(date, hour, now)
            ? 'past'
            : booking
              ? (booking.status as 'pending' | 'approved')
              : 'free';
          return { hour, state };
        }),
      })),
    };
  }

  /** The free slots of a day, flattened. Built on availability() so both agree by construction. */
  async freeSlots(date: unknown): Promise<FreeSlot[]> {
    const day = await this.availability(date);
    return day.labs.flatMap(({ lab, slots }) =>
      slots.filter((s) => s.state === 'free').map((s) => ({ lab, date: day.date, hour: s.hour })),
    );
  }

  async createLab(
    actor: User,
    input: { name?: unknown; building?: unknown; capacity?: unknown; description?: unknown },
  ): Promise<Lab> {
    if (actor.role !== 'admin') throw new ForbiddenError('Само администратор може да добавя лаборатории.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const building = typeof input.building === 'string' ? input.building.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const capacity = Number(input.capacity);
    if (!name || name.length > 80) throw new ValidationError('Въведи име на лабораторията до 80 знака.');
    if (!building || building.length > 80) throw new ValidationError('Въведи сграда до 80 знака.');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw new ValidationError('Капацитетът трябва да е цяло число между 1 и 500.');
    }
    if (description.length > 300) throw new ValidationError('Описанието трябва да е до 300 знака.');
    return this.labs.create({ name, building, capacity, description });
  }

  /** Adds a teacher to a lab's supervisors (the many-to-many). A student becomes a teacher. */
  async assignSupervisor(actor: User, labId: unknown, email: unknown): Promise<void> {
    if (actor.role !== 'admin') throw new ForbiddenError('Само администратор може да назначава преподаватели.');
    const lab = Number.isInteger(labId) ? await this.labs.findById(labId as number) : null;
    if (!lab) throw new NotFoundError('Няма такава лаборатория.');
    const user = typeof email === 'string' ? await this.users.findByEmail(email.trim()) : null;
    if (!user) throw new NotFoundError('Няма потребител с този имейл. Нека първо се регистрира.');
    if (user.role === 'student') await this.users.setRole(user.id, 'teacher');
    await this.labs.addSupervisor(lab.id, user.id);
  }
}

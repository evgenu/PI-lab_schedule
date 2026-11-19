import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { MAX_DAYS_AHEAD, daysBetween, isSlotInPast, isValidDate, isValidHour, localNow } from '../domain/time.js';
import { isActive, type Booking, type BookingStatus, type BookingView, type User } from '../domain/types.js';
import type { BookingRepo, LabRepo } from '../repos/types.js';
import type { Clock } from './auth.js';

export const MAX_UPCOMING_BOOKINGS = 3;

/**
 * Every rule about bookings lives here, including "may this person do this?".
 * HTTP routes and MCP tools both call these functions and add no rules of their own.
 */
export class BookingService {
  constructor(
    private readonly labs: LabRepo,
    private readonly bookings: BookingRepo,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async create(
    actor: User,
    input: { labId?: unknown; date?: unknown; hour?: unknown; purpose?: unknown },
  ): Promise<BookingView> {
    const { labId, date, hour } = input;
    if (!Number.isInteger(labId)) throw new ValidationError('Избери лаборатория.');
    if (!isValidDate(date)) throw new ValidationError('Избери валидна дата.');
    if (!isValidHour(hour)) throw new ValidationError('Часът трябва да е между 08:00 и 19:00.');
    const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
    if (purpose.length > 200) throw new ValidationError('Целта трябва да е до 200 знака.');

    const lab = await this.labs.findById(labId as number);
    if (!lab) throw new NotFoundError('Няма такава лаборатория.');

    const now = this.clock();
    if (isSlotInPast(date, hour, now)) throw new ValidationError('Не можеш да резервираш час, който вече е минал.');
    const today = localNow(now);
    if (daysBetween(today.date, date) > MAX_DAYS_AHEAD) {
      throw new ValidationError(`Можеш да резервираш най-много ${MAX_DAYS_AHEAD} дни напред.`);
    }

    const upcoming = await this.bookings.countUpcomingActive(actor.id, today.date, today.hour);
    if (upcoming >= MAX_UPCOMING_BOOKINGS) {
      throw new ConflictError(
        `Имаш вече ${MAX_UPCOMING_BOOKINGS} предстоящи резервации. Откажи някоя, за да направиш нова.`,
      );
    }

    // The repository (unique index) turns a taken slot into a ConflictError.
    const booking = await this.bookings.create({ labId: lab.id, userId: actor.id, date, hour, purpose });
    return { ...booking, labName: lab.name };
  }

  /** Only the person who made a booking may cancel it. */
  async cancel(actor: User, bookingId: unknown): Promise<BookingView> {
    const booking = await this.find(bookingId);
    if (booking.userId !== actor.id) throw new ForbiddenError('Можеш да отказваш само своите резервации.');
    if (!isActive(booking.status)) throw new ConflictError('Тази резервация вече не е активна.');
    if (isSlotInPast(booking.date, booking.hour, this.clock())) {
      throw new ConflictError('Не можеш да откажеш резервация, чийто час вече е започнал.');
    }
    const updated = await this.bookings.setStatus(booking.id, 'cancelled', actor.id, ['pending', 'approved']);
    if (!updated) throw new ConflictError('Тази резервация вече не е активна.');
    return this.withLabName(updated);
  }

  approve(actor: User, bookingId: unknown): Promise<BookingView> {
    return this.decide(actor, bookingId, 'approved');
  }

  reject(actor: User, bookingId: unknown): Promise<BookingView> {
    return this.decide(actor, bookingId, 'rejected');
  }

  async listMine(actor: User): Promise<BookingView[]> {
    return this.withLabNames(await this.bookings.listByUser(actor.id));
  }

  /** The approval queue: upcoming pending bookings in the labs this teacher supervises. */
  async listPending(actor: User): Promise<BookingView[]> {
    let scope: number[] | 'all';
    if (actor.role === 'admin') scope = 'all';
    else if (actor.role === 'teacher') scope = await this.labs.supervisedLabIds(actor.id);
    else throw new ForbiddenError('Само преподаватели одобряват резервации.');
    const now = this.clock();
    const pending = (await this.bookings.listPending(scope)).filter((b) => !isSlotInPast(b.date, b.hour, now));
    return this.withLabNames(pending);
  }

  private async decide(actor: User, bookingId: unknown, status: BookingStatus): Promise<BookingView> {
    const booking = await this.find(bookingId);
    const allowed =
      actor.role === 'admin' ||
      (actor.role === 'teacher' && (await this.labs.isSupervisor(booking.labId, actor.id)));
    if (!allowed) throw new ForbiddenError('Само преподавател, отговорен за тази лаборатория, може да решава.');
    if (booking.status !== 'pending') throw new ConflictError('Само чакаща резервация може да се одобри или откаже.');
    const updated = await this.bookings.setStatus(booking.id, status, actor.id, ['pending']);
    if (!updated) throw new ConflictError('Само чакаща резервация може да се одобри или откаже.');
    return this.withLabName(updated);
  }

  private async find(bookingId: unknown): Promise<Booking> {
    const booking = Number.isInteger(bookingId) ? await this.bookings.findById(bookingId as number) : null;
    if (!booking) throw new NotFoundError('Няма такава резервация.');
    return booking;
  }

  private async withLabName(booking: Booking): Promise<BookingView> {
    const lab = await this.labs.findById(booking.labId);
    return { ...booking, labName: lab?.name ?? '—' };
  }

  private async withLabNames(bookings: Booking[]): Promise<BookingView[]> {
    const names = new Map((await this.labs.list()).map((l) => [l.id, l.name]));
    return bookings.map((b) => ({ ...b, labName: names.get(b.labId) ?? '—' }));
  }
}

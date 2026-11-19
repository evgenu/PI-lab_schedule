import type { User } from '../domain/types.js';
import type { Services } from '../services/index.js';

export interface Tool {
  name: string;
  /** The only thing the model reads when it decides which tool to call. */
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, user: User): Promise<unknown>;
}

const date = { type: 'string', description: 'Calendar day in YYYY-MM-DD format (Europe/Sofia).' };
const bookingId = { type: 'integer', description: 'Id of the booking, as returned by my_bookings or pending_approvals.' };
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/**
 * Every tool calls exactly the service function the matching HTTP route calls
 * (shown in the comment), with the user from the session token. No tool runs
 * its own query, so every rule and every ownership check applies here too.
 */
export function buildTools(services: Services): Tool[] {
  return [
    {
      // GET /api/labs
      name: 'list_labs',
      description: 'List every university lab with its id, building, number of seats and equipment description.',
      inputSchema: schema(),
      run: () => services.labs.listLabs(),
    },
    {
      // GET /api/availability (filtered to free slots)
      name: 'list_free_slots',
      description: 'List the one-hour slots (08:00–20:00) that are still free in each lab on a given day.',
      inputSchema: schema({ date }, ['date']),
      run: async (args) => {
        const day = await services.labs.availability(args.date);
        return day.labs.map(({ lab, slots }) => ({
          labId: lab.id,
          lab: lab.name,
          capacity: lab.capacity,
          freeHours: slots.filter((s) => s.state === 'free').map((s) => s.hour),
        }));
      },
    },
    {
      // GET /api/bookings/mine
      name: 'my_bookings',
      description: "List the signed-in user's own bookings with their status: pending, approved, rejected or cancelled.",
      inputSchema: schema(),
      run: (_args, user) => services.bookings.listMine(user),
    },
    {
      // POST /api/bookings
      name: 'book_slot',
      description:
        'Request a booking of one lab for one hour. It starts as pending until a supervising teacher approves it.',
      inputSchema: schema(
        {
          labId: { type: 'integer', description: 'Id of the lab, from list_labs or list_free_slots.' },
          date,
          hour: { type: 'integer', minimum: 8, maximum: 19, description: 'Start hour of the slot, 8 to 19.' },
          purpose: { type: 'string', maxLength: 200, description: 'Short reason for the booking, shown to the teacher.' },
        },
        ['labId', 'date', 'hour'],
      ),
      run: (args, user) => services.bookings.create(user, args),
    },
    {
      // POST /api/bookings/:id/cancel
      name: 'cancel_booking',
      description: "Cancel one of the signed-in user's own upcoming bookings. Other people's bookings are refused.",
      inputSchema: schema({ bookingId }, ['bookingId']),
      run: (args, user) => services.bookings.cancel(user, args.bookingId),
    },
    {
      // POST /api/suggestions
      name: 'suggest_slot',
      description:
        'Describe what you need in words (people, equipment, time of day) and get one free slot suggested for that day.',
      inputSchema: schema(
        { text: { type: 'string', maxLength: 300, description: 'What the user needs, in their own words.' }, date },
        ['text', 'date'],
      ),
      run: (args, user) => services.suggestions.suggest(user, args),
    },
    {
      // GET /api/bookings/pending
      name: 'pending_approvals',
      description: 'For teachers: list upcoming bookings waiting for approval in the labs they supervise.',
      inputSchema: schema(),
      run: (_args, user) => services.bookings.listPending(user),
    },
    {
      // POST /api/bookings/:id/approve
      name: 'approve_booking',
      description: 'For teachers: approve a pending booking in a lab they supervise. Students are refused.',
      inputSchema: schema({ bookingId }, ['bookingId']),
      run: (args, user) => services.bookings.approve(user, args.bookingId),
    },
    {
      // POST /api/bookings/:id/reject
      name: 'reject_booking',
      description: 'For teachers: reject a pending booking in a lab they supervise, which frees the slot again.',
      inputSchema: schema({ bookingId }, ['bookingId']),
      run: (args, user) => services.bookings.reject(user, args.bookingId),
    },
  ];
}

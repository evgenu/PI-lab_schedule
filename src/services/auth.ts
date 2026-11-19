import { createHash, randomBytes } from 'node:crypto';
import { ConflictError, UnauthorizedError, ValidationError } from '../domain/errors.js';
import type { User } from '../domain/types.js';
import type { SessionRepo, UserRepo } from '../repos/types.js';
import { hashPassword, verifyPassword } from './password.js';

export type Clock = () => Date;

/** What a social provider tells us about the person, after we checked it with the provider. */
export interface ProviderProfile {
  provider: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface SignedIn {
  user: User;
  /** The raw session token. It goes into a cookie (or the MCP env) and is never stored. */
  token: string;
}

const SESSION_DAYS = 14;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_LOGIN = 'Грешен имейл или парола.';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async register(input: { email?: unknown; password?: unknown; name?: unknown }): Promise<SignedIn> {
    const email = normaliseEmail(input.email);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw new ValidationError('Въведи име до 100 знака.');
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200) {
      throw new ValidationError('Паролата трябва да е поне 8 знака.');
    }
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError('Вече има профил с този имейл. Влез с паролата си или с Google.');
    }
    const user = await this.users.create({ email, name, passwordHash: await hashPassword(input.password) });
    return { user, token: await this.startSession(user.id) };
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<SignedIn> {
    if (typeof input.email !== 'string' || typeof input.password !== 'string') {
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    const user = await this.users.findByEmail(input.email.trim());
    if (!user?.passwordHash) {
      // Spend the same time as a real check, so response time does not reveal which e-mails exist.
      await verifyPassword(input.password, await this.getDummyHash());
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedError(INVALID_LOGIN);
    }
    return { user, token: await this.startSession(user.id) };
  }

  /**
   * Social sign-in. One person, one account:
   *  1. a known (provider, subject) signs straight in;
   *  2. otherwise, an e-mail the provider has VERIFIED is linked to the account with that e-mail;
   *  3. an unverified e-mail is never linked, because anyone can type someone else's address
   *     into a profile; and it does not create an account either, so it cannot squat the address.
   */
  async loginWithProvider(profile: ProviderProfile): Promise<SignedIn> {
    const known = await this.users.findByIdentity(profile.provider, profile.subject);
    if (known) return { user: known, token: await this.startSession(known.id) };

    if (!profile.emailVerified) {
      throw new UnauthorizedError('Доставчикът не е потвърдил имейла ти, затова не можем да те впишем така.');
    }
    const email = normaliseEmail(profile.email);
    const user =
      (await this.users.findByEmail(email)) ??
      (await this.users.create({ email, name: profile.name.trim() || email, passwordHash: null }));
    await this.users.linkIdentity(user.id, profile.provider, profile.subject);
    return { user, token: await this.startSession(user.id) };
  }

  /** Issues an extra ordinary session for the signed-in user, e.g. for the MCP server. */
  async issueToken(user: User): Promise<string> {
    return this.startSession(user.id);
  }

  async userForToken(token: string | undefined | null): Promise<User | null> {
    if (!token) return null;
    const userId = await this.sessions.findUserId(hashToken(token), this.clock());
    return userId === null ? null : this.users.findById(userId);
  }

  async logout(token: string | undefined | null): Promise<void> {
    if (token) await this.sessions.delete(hashToken(token));
  }

  private async startSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.clock().getTime() + SESSION_DAYS * 86_400_000);
    await this.sessions.create(hashToken(token), userId, expiresAt);
    return token;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }
}

function normaliseEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new ValidationError('Въведи валиден имейл адрес.');
  }
  return email;
}

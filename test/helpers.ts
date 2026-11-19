import type { User } from '../src/domain/types.js';
import type { ModelClient } from '../src/model/client.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { createServices } from '../src/services/index.js';
import { hashPassword } from '../src/services/password.js';

/** Thursday 19 Nov 2026, 10:30 in Sofia (UTC+2). */
export const NOW = new Date('2026-11-19T08:30:00Z');
export const TODAY = '2026-11-19';
export const TOMORROW = '2026-11-20';

/** A small world: two labs, a student, a second student, a teacher of lab 1, a teacher of lab 2, an admin. */
export async function makeWorld(options: { model?: ModelClient | null; modelTimeoutMs?: number; now?: () => Date } = {}) {
  const repos = createMemoryRepos();
  const clock = options.now ?? (() => NOW);
  const logs: string[] = [];
  const services = createServices(repos, {
    model: options.model ?? null,
    modelTimeoutMs: options.modelTimeoutMs ?? 200,
    clock,
    log: (m) => logs.push(m),
  });
  const network = await repos.labs.create({ name: 'Мрежи', building: 'Блок 1', capacity: 20, description: 'Cisco' });
  const robots = await repos.labs.create({ name: 'Роботика', building: 'Блок 2', capacity: 4, description: '3D принтер' });

  const hash = await hashPassword('correct horse');
  const user = (email: string, name: string, role: User['role']) =>
    repos.users.create({ email, name, role, passwordHash: hash });
  const student = await user('ana@tu-sofia.bg', 'Ана', 'student');
  const other = await user('boris@tu-sofia.bg', 'Борис', 'student');
  const teacher = await user('petrov@tu-sofia.bg', 'Петров', 'teacher');
  const otherTeacher = await user('ivanova@tu-sofia.bg', 'Иванова', 'teacher');
  const admin = await user('admin@tu-sofia.bg', 'Админ', 'admin');
  await repos.labs.addSupervisor(network.id, teacher.id);
  await repos.labs.addSupervisor(robots.id, otherTeacher.id);

  return { repos, services, logs, labs: { network, robots }, users: { student, other, teacher, otherTeacher, admin } };
}

/** Asserts that a promise rejects with an AppError of the given HTTP status. */
export async function rejectsWith(promise: Promise<unknown>, status: number): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { status?: number }).status;
    if (actual !== status) throw new Error(`Expected status ${status}, got ${actual}: ${(error as Error).message}`);
    return error as Error;
  }
  throw new Error(`Expected a rejection with status ${status}, but it resolved`);
}

export class FakeModel implements ModelClient {
  prompts: string[] = [];
  constructor(private readonly answer: (prompt: string, signal: AbortSignal) => Promise<string>) {}
  generate(prompt: string, signal: AbortSignal): Promise<string> {
    this.prompts.push(prompt);
    return this.answer(prompt, signal);
  }
}

import type { Repos } from './repos/types.js';
import { hashPassword } from './services/password.js';

export const DEMO_LABS = [
  { name: 'Лаб. 1250 – Компютърни мрежи', building: 'Блок 1', capacity: 20, description: 'Cisco рутери и комутатори, 20 работни места.' },
  { name: 'Лаб. 1306 – Микропроцесори', building: 'Блок 1', capacity: 12, description: 'Осцилоскопи, развойни платки STM32 и Arduino.' },
  { name: 'Лаб. 2112 – Програмиране', building: 'Блок 2', capacity: 30, description: 'Тиха зала с 30 компютъра, Linux и Windows.' },
  { name: 'Лаб. 2208 – Роботика', building: 'Блок 2', capacity: 8, description: 'Малка зала с 3D принтер и роботизирани ръце.' },
];

/** Creates the demo labs (only into an empty database) and, if given, the first admin. Safe to run twice. */
export async function seed(repos: Repos, admin?: { email: string; password: string }): Promise<string[]> {
  const done: string[] = [];
  if ((await repos.labs.list()).length === 0) {
    for (const lab of DEMO_LABS) await repos.labs.create(lab);
    done.push(`${DEMO_LABS.length} labs`);
  }
  if (admin?.email && admin.password) {
    const existing = await repos.users.findByEmail(admin.email);
    if (existing) {
      await repos.users.setRole(existing.id, 'admin');
    } else {
      await repos.users.create({
        email: admin.email.toLowerCase(),
        name: 'Администратор',
        passwordHash: await hashPassword(admin.password),
        role: 'admin',
      });
    }
    done.push(`admin ${admin.email}`);
  }
  return done;
}

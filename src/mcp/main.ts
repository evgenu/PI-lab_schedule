// `npm run mcp`: the project's MCP server over stdio.
// It acts as ONE user, identified by an ordinary session token in LAB_SESSION_TOKEN,
// so an agent can do exactly what that person can do in the browser, and nothing more.
import { createInterface } from 'node:readline';
import { loadConfig, loadDotEnv } from '../config.js';
import { buildServices } from '../wiring.js';
import { handleLine } from './protocol.js';
import { buildTools } from './tools.js';

// stdout carries protocol messages only, so every log line goes to stderr.
console.log = console.warn = (...args: unknown[]) => process.stderr.write(`${args.join(' ')}\n`);

loadDotEnv();
const { services, close } = await buildServices(loadConfig());
const token = process.env.LAB_SESSION_TOKEN;
const deps = {
  tools: buildTools(services),
  resolveUser: () => services.auth.userForToken(token),
  log: (m: string) => process.stderr.write(`${m}\n`),
};

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const response = await handleLine(line, deps);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
await close();

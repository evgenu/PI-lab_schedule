// `npm start`: the web server (REST API + the static front end).
import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadConfig, loadDotEnv } from './config.js';
import { createApp } from './http/app.js';
import { GoogleOAuth } from './http/googleOAuth.js';
import { buildServices } from './wiring.js';

loadDotEnv();
const config = loadConfig();
const { services } = await buildServices(config);

const oauth = config.google
  ? new GoogleOAuth(config.google.clientId, config.google.clientSecret, `${config.baseUrl}/api/auth/google/callback`)
  : null;

const app = createApp({
  services,
  oauth,
  secureCookies: config.secureCookies,
  publicDir: join(process.cwd(), 'public'),
});

createServer((req, res) => void app(req, res)).listen(config.port, () => {
  console.log(`Lab booking listening on ${config.baseUrl} (port ${config.port})`);
});

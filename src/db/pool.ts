import pg from 'pg';

// A DATE column would otherwise become a JS Date at local midnight, which can
// shift the day by one depending on the server's time zone. Keep it a string.
pg.types.setTypeParser(1082, (value: string) => value);

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    // Neon requires TLS; a local Postgres usually does not offer it.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 5_000,
  });
}

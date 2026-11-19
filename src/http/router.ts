/** A very small router: "GET /api/bookings/:id" → handler, with :id captured. */
export interface Route<H> {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: H;
}

export type Match<H> =
  | { kind: 'found'; handler: H; params: Record<string, string> }
  | { kind: 'method-not-allowed' }
  | { kind: 'not-found' };

export class Router<H> {
  private readonly routes: Route<H>[] = [];

  add(method: string, path: string, handler: H): this {
    const keys: string[] = [];
    const source = path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  match(method: string, pathname: string): Match<H> {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.pattern.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(found[i + 1]!)));
      return { kind: 'found', handler: route.handler, params };
    }
    return pathMatched ? { kind: 'method-not-allowed' } : { kind: 'not-found' };
  }
}

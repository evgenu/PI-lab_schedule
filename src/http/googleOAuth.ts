import { UnauthorizedError } from '../domain/errors.js';
import type { ProviderProfile } from '../services/auth.js';

export interface OAuthProvider {
  authUrl(state: string): string;
  profileFromCode(code: string): Promise<ProviderProfile>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Google sign-in with the authorization-code flow:
 *  1. send the browser to Google with a random `state`;
 *  2. Google sends it back with a one-time `code`;
 *  3. the server swaps the code for an access token (with the client secret, server to server);
 *  4. the server asks Google's userinfo endpoint who this is, including `email_verified`.
 * Because step 4 is a direct HTTPS call to Google, its answer can be trusted as is.
 */
export class GoogleOAuth implements OAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async profileFromCode(code: string): Promise<ProviderProfile> {
    const tokenResponse = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new UnauthorizedError('Google отказа входа. Опитай отново.');
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };

    const infoResponse = await this.fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoResponse.ok) throw new UnauthorizedError('Не успяхме да прочетем профила ти в Google.');
    const info = (await infoResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!info.sub || !info.email) throw new UnauthorizedError('Google не върна имейл за този профил.');
    return {
      provider: 'google',
      subject: info.sub,
      email: info.email,
      emailVerified: info.email_verified === true,
      name: info.name ?? '',
    };
  }
}

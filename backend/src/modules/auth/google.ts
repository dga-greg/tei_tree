import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface GoogleProfile {
  /** Google's stable account id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** Google Workspace domain, when the account belongs to one (its addresses are managed by that domain). */
  hostedDomain: string | null;
}

export interface GoogleAuthorizeParams {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

/** Sign in with Google (OpenID Connect, authorization code flow with PKCE). */
export interface GoogleIdentity {
  readonly enabled: boolean;
  authorizeUrl(params: GoogleAuthorizeParams): string;
  /** Exchanges the code for an ID token, checks it, and returns who signed in. */
  exchange(code: string, codeVerifier: string, redirectUri: string, nonce: string): Promise<GoogleProfile>;
}

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS: [string, string] = ['https://accounts.google.com', 'accounts.google.com'];
const KEYS_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

export class GoogleSignInError extends Error {}

export class HttpGoogleIdentity implements GoogleIdentity {
  readonly enabled = true;
  private keys: { at: number; byKid: Map<string, KeyObject> } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  authorizeUrl(p: GoogleAuthorizeParams): string {
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchange(code: string, codeVerifier: string, redirectUri: string, nonce: string): Promise<GoogleProfile> {
    const res = await this.fetcher(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, code_verifier: codeVerifier, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new GoogleSignInError(`Google refused the sign-in code (${res.status})`);
    const body = (await res.json()) as { id_token?: string };
    if (!body.id_token) throw new GoogleSignInError('Google sent no ID token');
    return this.verifyIdToken(body.id_token, nonce);
  }

  /** Checks the ID token's signature against Google's published keys, and its issuer, audience, expiry and nonce. */
  async verifyIdToken(idToken: string, nonce: string): Promise<GoogleProfile> {
    const header = jwt.decode(idToken, { complete: true })?.header;
    if (!header?.kid) throw new GoogleSignInError('Malformed ID token');
    const key = await this.key(header.kid);
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(idToken, key, { algorithms: ['RS256'], audience: this.clientId, issuer: ISSUERS }) as jwt.JwtPayload;
    } catch (err) {
      throw new GoogleSignInError(`Invalid ID token: ${(err as Error).message}`);
    }
    if (claims['nonce'] !== nonce) throw new GoogleSignInError('ID token nonce does not match');
    if (typeof claims.sub !== 'string' || typeof claims['email'] !== 'string') throw new GoogleSignInError('ID token lacks an account or e-mail');
    return {
      sub: claims.sub,
      email: (claims['email'] as string).toLowerCase(),
      emailVerified: claims['email_verified'] === true || claims['email_verified'] === 'true',
      name: typeof claims['name'] === 'string' ? (claims['name'] as string) : '',
      hostedDomain: typeof claims['hd'] === 'string' ? (claims['hd'] as string) : null,
    };
  }

  private async key(kid: string): Promise<KeyObject> {
    if (!this.keys || Date.now() - this.keys.at > KEYS_TTL_MS || !this.keys.byKid.has(kid)) {
      const res = await this.fetcher(JWKS, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new GoogleSignInError(`Could not fetch Google's keys (${res.status})`);
      const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
      this.keys = { at: Date.now(), byKid: new Map(keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])) };
    }
    const key = this.keys.byKid.get(kid);
    if (!key) throw new GoogleSignInError('ID token signed with an unknown key');
    return key;
  }
}

export class DisabledGoogleIdentity implements GoogleIdentity {
  readonly enabled = false;
  authorizeUrl(): string {
    throw new GoogleSignInError('Google sign-in is not set up');
  }
  exchange(): Promise<GoogleProfile> {
    return Promise.reject(new GoogleSignInError('Google sign-in is not set up'));
  }
}

export function googleFromEnv(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }): GoogleIdentity {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? new HttpGoogleIdentity(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET) : new DisabledGoogleIdentity();
}

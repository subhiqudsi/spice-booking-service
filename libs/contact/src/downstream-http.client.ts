import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, Env } from '@app/common';

export class DownstreamNotAllowedError extends Error {
  constructor(host: string) {
    super(`Host ${host} is not in the downstream allowlist`);
    this.name = 'DownstreamNotAllowedError';
  }
}

export interface DownstreamRequest {
  method?: 'GET' | 'POST';
  /** The caller's other-service token. Only sent to allowlisted hosts. */
  serviceToken?: string;
  timeoutMs: number;
  body?: unknown;
}

/**
 * The only HTTP client allowed to carry the other-service JWT (DESIGN.md §3.1). Feature code passes
 * the token in; this class decides whether the host may receive it and adds the header itself.
 */
@Injectable()
export class DownstreamHttpClient {
  private readonly allowlist: Set<string>;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    this.allowlist = new Set(
      [...env.DOWNSTREAM_ALLOWLIST, new URL(env.CONTACT_API_BASE_URL).host].map((h) => h.toLowerCase()),
    );
  }

  isAllowed(url: string): boolean {
    return this.allowlist.has(new URL(url).host.toLowerCase());
  }

  async request(url: string, req: DownstreamRequest): Promise<Response> {
    const host = new URL(url).host;
    if (!this.isAllowed(url)) throw new DownstreamNotAllowedError(host);

    const headers: Record<string, string> = { accept: 'application/json' };
    if (req.body !== undefined) headers['content-type'] = 'application/json';
    if (req.serviceToken) {
      const name = this.env.SERVICE_AUTH_HEADER;
      headers[name] = name === 'authorization' ? `Bearer ${req.serviceToken}` : req.serviceToken;
    }

    return fetch(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(req.timeoutMs),
      redirect: 'error', // a redirect could send the token to a host outside the allowlist
    });
  }
}

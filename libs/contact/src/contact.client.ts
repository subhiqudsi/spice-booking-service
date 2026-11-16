import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APP_ENV, DomainError, Env, ErrorCode } from '@app/common';
import { DownstreamHttpClient } from './downstream-http.client';

export interface Contact {
  name: string;
  phone: string;
  email: string;
}

/**
 * Expected Contact system response. OPEN POINT (DESIGN.md §10 #7): the real field names are not
 * confirmed yet; adjust this schema and `toContact` once they are.
 */
const contactResponseSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(3),
  email: z.string().email(),
});

function toContact(body: z.infer<typeof contactResponseSchema>): Contact {
  return { name: body.name, phone: body.phone, email: body.email };
}

class RetryableContactError extends Error {}

/** Fetches the caller's contact details, forwarding their JWT (DESIGN.md §4.2 step 2). */
@Injectable()
export class ContactClient {
  private readonly logger = new Logger(ContactClient.name);
  private readonly url: string;

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly http: DownstreamHttpClient,
  ) {
    this.url = new URL(env.CONTACT_API_CONTACT_PATH, env.CONTACT_API_BASE_URL).toString();
  }

  async getContact(serviceToken: string, requestId: string): Promise<Contact> {
    const attempts = this.env.CONTACT_API_RETRIES + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.fetchOnce(serviceToken);
      } catch (err) {
        lastError = err;
        if (!(err instanceof RetryableContactError) || attempt === attempts) break;
        this.logger.warn({ requestId, attempt, reason: err.message }, 'contact lookup retry');
      }
    }

    throw new DomainError(ErrorCode.CONTACT_LOOKUP_FAILED, 'Could not load contact details for this user.', [], {
      reason: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }

  private async fetchOnce(serviceToken: string): Promise<Contact> {
    let res: Response;
    try {
      res = await this.http.request(this.url, { serviceToken, timeoutMs: this.env.CONTACT_API_TIMEOUT_MS });
    } catch (err) {
      // timeout or network failure
      throw new RetryableContactError(err instanceof Error ? err.name : 'network error');
    }
    if (res.status >= 500) throw new RetryableContactError(`contact system returned ${res.status}`);
    if (!res.ok) throw new Error(`contact system returned ${res.status}`);

    const parsed = contactResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new Error('contact system response did not match the expected shape');
    return toContact(parsed.data);
  }
}

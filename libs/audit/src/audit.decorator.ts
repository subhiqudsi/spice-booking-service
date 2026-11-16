import { SetMetadata } from '@nestjs/common';

export const AUDIT_META = 'booking:audit';

export interface AuditOptions {
  resourceType?: string;
  /** Picks the resource id from the handler's response body or the request params. */
  resourceId?: (response: unknown, params: Record<string, string>) => string | undefined;
}

export interface AuditMeta extends AuditOptions {
  action: string;
}

/** Marks a controller handler for auditing by AuditInterceptor (success and failure). */
export const Audit = (action: string, options: AuditOptions = {}) =>
  SetMetadata(AUDIT_META, { action, ...options } satisfies AuditMeta);

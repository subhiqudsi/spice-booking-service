export type AuditActorType = 'api_client' | 'admin' | 'agent' | 'system';
export type AuditOutcome = 'success' | 'failure' | 'denied';

/**
 * One audit row (DESIGN.md §8.1). PII rule: no contact details, service tokens or API keys —
 * only the key prefix and the hashed user_ref.
 */
export interface AuditEntry {
  occurredAt?: string;
  actorType: AuditActorType;
  actorId?: string | null;
  apiKeyPrefix?: string | null;
  userRef?: string | null;
  tokenIssuer?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome: AuditOutcome;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  changes?: { before?: unknown; after?: unknown } | null;
  metadata?: Record<string, unknown> | null;
}

import type { IncomingMessage } from 'http';
import { ulid } from 'ulid';

/** The calling system, set by ApiKeyGuard. */
export interface ApiClientPrincipal {
  clientId: string;
  clientName: string;
  keyId: string;
  keyPrefix: string;
  scopes: string[];
  tenant: string | null;
}

/** The caller's identity in the other services, set by ServiceAuthGuard. */
export interface ServicePrincipal {
  subject: string;
  userRef: string;
  issuer: string;
  claims: Record<string, unknown>;
}

/** Per-request context. Flows into queue jobs, logs, audit rows and error rows. */
export interface RequestContext {
  requestId: string;
  apiClient?: ApiClientPrincipal;
  principal?: ServicePrincipal;
  ip?: string;
  userAgent?: string;
}

/**
 * The raw other-service token is kept under a symbol so it never shows up when the request
 * or context is serialized (JSON.stringify and pino both skip symbol keys).
 */
export const SERVICE_TOKEN = Symbol('serviceToken');

const CTX = Symbol('bookingCtx');

type RawWithCtx = IncomingMessage & { id?: string; [CTX]?: RequestContext; [SERVICE_TOKEN]?: string };

/** Minimal shape shared by Fastify requests in guards, filters and interceptors. */
export interface HttpRequestLike {
  raw: IncomingMessage;
  id?: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** Reads a caller-supplied x-request-id if it looks safe, otherwise makes a new one. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID_PATTERN.test(value) ? value : ulid();
}

export function getRequestContext(req: HttpRequestLike): RequestContext {
  const raw = req.raw as RawWithCtx;
  if (!raw[CTX]) {
    const ua = req.headers['user-agent'];
    raw[CTX] = {
      // Fastify's request.id (set by genReqId in bootstrap.ts) wins; raw.id is set by pino-http.
      requestId: req.id ?? raw.id ?? resolveRequestId(req.headers['x-request-id']),
      ip: req.ip,
      userAgent: Array.isArray(ua) ? ua[0] : ua,
    };
  }
  return raw[CTX]!;
}

/** Same context, reachable from the raw Node request (used by the pino customProps hook). */
export function getRawRequestContext(raw: IncomingMessage): RequestContext | undefined {
  return (raw as RawWithCtx)[CTX];
}

export function setServiceToken(req: HttpRequestLike, token: string): void {
  (req.raw as RawWithCtx)[SERVICE_TOKEN] = token;
}

export function getServiceToken(req: HttpRequestLike): string | undefined {
  return (req.raw as RawWithCtx)[SERVICE_TOKEN];
}

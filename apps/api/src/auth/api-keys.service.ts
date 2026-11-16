import { Inject, Injectable } from '@nestjs/common';
import { ApiClient, ApiKey } from '@prisma/client';
import { APP_ENV, DomainError, Env, ErrorCode, safeEqual } from '@app/common';
import { PrismaService } from '@app/database';
import { generateApiKey, hashApiKey, parseApiKey, Scope } from './api-key.util';

export type VerifyFailure = 'missing' | 'malformed' | 'unknown' | 'revoked' | 'expired' | 'client_inactive';

export type VerifyResult =
  | { ok: true; key: ApiKey & { client: ApiClient } }
  | { ok: false; reason: VerifyFailure; prefix?: string };

export interface CreateKeyInput {
  clientId?: string;
  clientName?: string;
  tenant?: string | null;
  scopes: Scope[];
  expiresAt?: Date | null;
  createdBy?: string | null;
}

@Injectable()
export class ApiKeysService {
  /** last_used_at is written at most once a minute per key. */
  private readonly lastTouched = new Map<string, number>();

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async verify(rawKey: string | undefined): Promise<VerifyResult> {
    if (!rawKey) return { ok: false, reason: 'missing' };
    const parsed = parseApiKey(rawKey);
    if (!parsed) return { ok: false, reason: 'malformed' };

    const key = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix }, include: { client: true } });
    if (!key || !safeEqual(key.keyHash, hashApiKey(rawKey, this.env.API_KEY_PEPPER))) {
      return { ok: false, reason: 'unknown', prefix: parsed.prefix };
    }
    if (key.status !== 'active') return { ok: false, reason: 'revoked', prefix: parsed.prefix };
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired', prefix: parsed.prefix };
    if (key.client.status !== 'active') return { ok: false, reason: 'client_inactive', prefix: parsed.prefix };

    this.touch(key.id);
    return { ok: true, key };
  }

  /** Creates a key and returns the full value once. It is never retrievable again. */
  async create(input: CreateKeyInput): Promise<{ key: string; record: ApiKey; client: ApiClient }> {
    const client = input.clientId
      ? await this.prisma.apiClient.findUnique({ where: { id: input.clientId } })
      : await this.prisma.apiClient.create({ data: { name: input.clientName ?? 'unnamed client', tenant: input.tenant ?? null } });
    if (!client) throw new DomainError(ErrorCode.NOT_FOUND, `API client ${input.clientId} not found.`);

    const { key, prefix } = generateApiKey(this.env.API_KEY_ENV);
    const record = await this.prisma.apiKey.create({
      data: {
        clientId: client.id,
        prefix,
        keyHash: hashApiKey(key, this.env.API_KEY_PEPPER),
        scopes: [...new Set(input.scopes)],
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    return { key, record, client };
  }

  async revoke(id: string): Promise<ApiKey> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw new DomainError(ErrorCode.NOT_FOUND, `API key ${id} not found.`);
    return this.prisma.apiKey.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date() } });
  }

  async list() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        prefix: true,
        scopes: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
        client: { select: { id: true, name: true, tenant: true, status: true } },
      },
    });
  }

  private touch(keyId: string): void {
    const now = Date.now();
    if (now - (this.lastTouched.get(keyId) ?? 0) < 60_000) return;
    this.lastTouched.set(keyId, now);
    void this.prisma.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  }
}

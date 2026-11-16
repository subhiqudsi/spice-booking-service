import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DomainError, ErrorCode, getRequestContext } from '@app/common';
import { Audit } from '@app/audit';
import { ApiKeysService } from '../auth/api-keys.service';
import { Scopes } from '../auth/decorators';
import { CreateApiKeyDto } from './internal.dto';

@Controller('internal/api-keys')
@Scopes('admin')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  /** Returns the full key once. Store it now: it can't be shown again. */
  @Post()
  @Audit('api_key.created', { resourceType: 'api_key', resourceId: (res) => (res as { id?: string })?.id })
  async create(@Body() dto: CreateApiKeyDto, @Req() req: FastifyRequest) {
    if (!dto.client_id && !dto.client_name) {
      throw new DomainError(ErrorCode.VALIDATION_ERROR, 'Give client_id or client_name.', [
        { field: 'client_id', issue: 'client_id or client_name is required' },
      ]);
    }
    const ctx = getRequestContext(req);
    const { key, record, client } = await this.keys.create({
      clientId: dto.client_id,
      clientName: dto.client_name,
      tenant: dto.tenant,
      scopes: dto.scopes,
      expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
      createdBy: ctx.apiClient?.keyPrefix ?? null,
    });
    return {
      id: record.id,
      key,
      prefix: record.prefix,
      scopes: record.scopes,
      expires_at: record.expiresAt,
      client: { id: client.id, name: client.name, tenant: client.tenant },
    };
  }

  @Get()
  list() {
    return this.keys.list();
  }

  @Delete(':id')
  @Audit('api_key.revoked', { resourceType: 'api_key' })
  async revoke(@Param('id') id: string) {
    const revoked = await this.keys.revoke(id);
    return { id: revoked.id, prefix: revoked.prefix, status: revoked.status, revoked_at: revoked.revokedAt };
  }
}

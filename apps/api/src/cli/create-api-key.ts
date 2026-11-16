/**
 * Creates the first API key (or any key) without going through the HTTP API.
 *
 *   npm run apikey:create -- --client "Spice backend" --scopes shifts:read,reservations:write,reservations:read
 *   npm run apikey:create -- --client "Ops admin" --scopes admin
 *
 * Prints the key once. Store it in your secret manager; only its hash is kept.
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { generateApiKey, hashApiKey, SCOPES, Scope } from '../auth/api-key.util';

config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const clientName = arg('client');
  const scopes = (arg('scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const tenant = arg('tenant');
  const pepper = process.env.API_KEY_PEPPER;
  const keyEnv = process.env.API_KEY_ENV === 'live' ? 'live' : 'test';

  if (!clientName || scopes.length === 0) {
    throw new Error('Usage: --client "<name>" --scopes scope1,scope2 [--tenant <tenant>]');
  }
  const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`Unknown scope(s): ${unknown.join(', ')}. Valid: ${SCOPES.join(', ')}`);
  if (!pepper || pepper.length < 32) throw new Error('API_KEY_PEPPER must be set (32+ chars).');

  const prisma = new PrismaClient();
  try {
    const client = await prisma.apiClient.create({ data: { name: clientName, tenant: tenant ?? null } });
    const { key, prefix } = generateApiKey(keyEnv);
    await prisma.apiKey.create({
      data: { clientId: client.id, prefix, keyHash: hashApiKey(key, pepper), scopes: scopes as Scope[], createdBy: 'cli' },
    });
    process.stdout.write(
      `Created API key for "${clientName}" (client ${client.id})\n` +
        `prefix: ${prefix}\nscopes: ${scopes.join(', ')}\n\n${key}\n\nStore it now; it can't be shown again.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

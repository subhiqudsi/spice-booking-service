import { SetMetadata } from '@nestjs/common';
import type { Scope } from './api-key.util';

export const PUBLIC_META = 'booking:public';
export const SCOPES_META = 'booking:scopes';

/** Skips both auth guards. Only for /health. */
export const Public = () => SetMetadata(PUBLIC_META, true);

/** The API key must hold every listed scope. */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES_META, scopes);

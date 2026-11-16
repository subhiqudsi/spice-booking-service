import { Module } from '@nestjs/common';
import { ContactClient } from './contact.client';
import { DownstreamHttpClient } from './downstream-http.client';

@Module({
  providers: [DownstreamHttpClient, ContactClient],
  exports: [DownstreamHttpClient, ContactClient],
})
export class ContactModule {}

export { ContactClient } from './contact.client';
export type { Contact } from './contact.client';
export { DownstreamHttpClient, DownstreamNotAllowedError } from './downstream-http.client';

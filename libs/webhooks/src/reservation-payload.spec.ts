import type { Reservation } from '@prisma/client';
import { buildReservationPayload } from './reservation-webhook.service';

const base: Reservation = {
  id: 'res_1',
  apiClientId: 'cli_1',
  userRef: 'usr_abc',
  idempotencyKey: 'idem-0001',
  requestHash: 'h',
  restaurantId: 'spice-123',
  platform: 'sevenrooms',
  venueId: 'rowon45',
  datetime: new Date('2026-11-20T15:00:00Z'),
  localDate: '2026-11-20',
  localTime: '19:00',
  partySize: 4,
  notes: null,
  status: 'pending',
  platformConfirmationCode: null,
  bookingAttempts: 1,
  inFlight: false,
  submitted: false,
  scriptId: null,
  errorCode: null,
  errorDetail: null,
  requestId: 'req_1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const at = new Date('2026-11-20T15:01:00Z');

describe('buildReservationPayload', () => {
  it('builds reservation.confirmed with the confirmation code and no error', () => {
    const p = buildReservationPayload('evt_1', { ...base, status: 'confirmed', platformConfirmationCode: 'ABC123', submitted: true }, at);
    expect(p).toMatchObject({
      type: 'reservation.confirmed',
      status: 'confirmed',
      platform_confirmation_code: 'ABC123',
      error_code: null,
      error_message: null,
      submitted: true,
      party_size: 4,
    });
  });

  it('builds reservation.failed with the error and no confirmation code', () => {
    const p = buildReservationPayload(
      'evt_2',
      { ...base, status: 'failed', errorCode: 'PLATFORM_BLOCKED', errorDetail: 'challenge page' },
      at,
    );
    expect(p).toMatchObject({
      type: 'reservation.failed',
      status: 'failed',
      platform_confirmation_code: null,
      error_code: 'PLATFORM_BLOCKED',
      submitted: false,
    });
  });

  it('never carries contact details or the idempotency key', () => {
    const p = buildReservationPayload('evt_3', { ...base, status: 'confirmed', platformConfirmationCode: 'X' }, at);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/phone|email|contact|idem-0001/);
  });

  it('refuses to build an event for a pending reservation', () => {
    expect(() => buildReservationPayload('evt_4', base, at)).toThrow();
  });
});

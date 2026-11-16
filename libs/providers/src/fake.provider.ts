import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, BookingFailureCode, Env, isBookingFailureCode, sha256Hex } from '@app/common';
import type { Contact } from '@app/contact';
import { BookingRequest, BookingResult, ReservationProvider, RunContext, Shift } from './reservation-provider';

const SHIFT_PLAN = [
  { shiftId: 'lunch', name: 'Lunch', from: 12 * 60, to: 14 * 60 },
  { shiftId: 'dinner', name: 'Dinner', from: 18 * 60, to: 22 * 60 },
];

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Deterministic in-memory platform for local development and tests (platform id `fake`).
 * Set FAKE_PROVIDER_FAIL_CODE to make every booking fail with that code.
 */
@Injectable()
export class FakeProvider implements ReservationProvider {
  readonly platform = 'fake';

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  async getShifts(venueId: string, date: string, partySize: number, _ctx: RunContext): Promise<Shift[]> {
    return SHIFT_PLAN.map((plan) => {
      const slots = [];
      for (let m = plan.from; m < plan.to; m += 30) {
        const time = hhmm(m);
        // About one slot in four is taken, stable for the same venue/date/time/party size.
        const taken = parseInt(sha256Hex(`${venueId}|${date}|${time}|${partySize}`).slice(0, 2), 16) < 64;
        slots.push({ time, available: !taken });
      }
      return { shiftId: plan.shiftId, name: plan.name, slots };
    });
  }

  async submit(req: BookingRequest, _contact: Contact, _ctx: RunContext): Promise<BookingResult> {
    const failCode = this.env.FAKE_PROVIDER_FAIL_CODE;
    if (failCode && isBookingFailureCode(failCode)) {
      return {
        status: 'failed',
        errorCode: failCode,
        message: `Fake provider configured to fail with ${failCode}.`,
        submitted: failCode === BookingFailureCode.OUTCOME_UNKNOWN,
        retryable: failCode === BookingFailureCode.PLATFORM_UNAVAILABLE,
      };
    }
    return {
      status: 'confirmed',
      confirmationCode: `FAKE-${sha256Hex(req.reservationId).slice(0, 8).toUpperCase()}`,
      confirmed: { date: req.date, time: req.time, partySize: req.partySize },
    };
  }
}

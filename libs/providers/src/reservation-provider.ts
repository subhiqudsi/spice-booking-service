import { BookingFailureCode } from '@app/common';
import type { Contact } from '@app/contact';

export interface Slot {
  /** Venue-local time HH:mm */
  time: string;
  available: boolean;
}

export interface Shift {
  shiftId: string;
  name: string;
  slots: Slot[];
}

export interface BookingRequest {
  reservationId: string;
  restaurantId: string;
  venueId: string;
  /** Venue-local date YYYY-MM-DD */
  date: string;
  /** Venue-local time HH:mm */
  time: string;
  partySize: number;
  notes?: string | null;
}

export type BookingResult =
  | {
      status: 'confirmed';
      confirmationCode: string;
      /** What the platform's confirmation screen showed. Checked against the request by the worker. */
      confirmed: { date: string; time: string; partySize: number };
    }
  | {
      status: 'failed';
      errorCode: BookingFailureCode;
      message: string;
      /** True once the final confirm click happened. Such failures are never retried. */
      submitted: boolean;
      /** True only for failures before the confirm click that may succeed on another try. */
      retryable: boolean;
    };

export interface RunContext {
  requestId: string;
}

/** One implementation per reservation platform (DESIGN.md §5). */
export interface ReservationProvider {
  readonly platform: string;
  getShifts(venueId: string, date: string, partySize: number, ctx: RunContext): Promise<Shift[]>;
  submit(req: BookingRequest, contact: Contact, ctx: RunContext): Promise<BookingResult>;
}

export const RESERVATION_PROVIDERS = Symbol('RESERVATION_PROVIDERS');

/**
 * Thrown by `getShifts` when the script itself broke (a selector stopped matching, the response no
 * longer fits the schema). Unlike a down or blocked platform, this starts a script repair.
 */
export class ScriptFailureError extends Error {
  constructor(
    readonly errorCode: 'SCRIPT_FAILED' | 'UNEXPECTED_STEP',
    message: string,
  ) {
    super(message);
    this.name = 'ScriptFailureError';
  }
}

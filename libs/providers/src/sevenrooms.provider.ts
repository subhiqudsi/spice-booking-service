import { Injectable } from '@nestjs/common';
import { BookingFailureCode, DomainError, ErrorCode } from '@app/common';
import type { Contact } from '@app/contact';
import { BookingRequest, BookingResult, ReservationProvider, RunContext, Shift } from './reservation-provider';

/**
 * Placeholder. Delivery plan step 2 replaces this with the Playwright script runner:
 * load the active script from the registry and run it in the sandbox (DESIGN.md §5.1).
 */
@Injectable()
export class SevenRoomsProvider implements ReservationProvider {
  readonly platform = 'sevenrooms';

  async getShifts(_venueId: string, _date: string, _partySize: number, _ctx: RunContext): Promise<Shift[]> {
    throw new DomainError(ErrorCode.PLATFORM_UNAVAILABLE, 'SevenRooms support is not built yet.');
  }

  async submit(_req: BookingRequest, _contact: Contact, _ctx: RunContext): Promise<BookingResult> {
    return {
      status: 'failed',
      errorCode: BookingFailureCode.SCRIPT_FAILED,
      message: 'SevenRooms support is not built yet.',
      submitted: false,
      retryable: false,
    };
  }
}

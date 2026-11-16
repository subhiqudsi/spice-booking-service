import { BookingFailureCode } from '@app/common';
import { decideSubmit } from './submit-policy';

const request = { date: '2026-11-20', time: '19:00', partySize: 4 };

describe('decideSubmit', () => {
  it('confirms when the confirmation screen matches', () => {
    const d = decideSubmit({ status: 'confirmed', confirmationCode: 'ABC', confirmed: { ...request } }, request, 1, 3);
    expect(d).toEqual({ kind: 'confirmed', confirmationCode: 'ABC' });
  });

  it('fails with CONFIRMATION_MISMATCH when party size differs', () => {
    const d = decideSubmit(
      { status: 'confirmed', confirmationCode: 'ABC', confirmed: { ...request, partySize: 2 } },
      request,
      1,
      3,
    );
    expect(d.kind).toBe('failed');
    if (d.kind === 'failed') {
      expect(d.failure.errorCode).toBe(BookingFailureCode.CONFIRMATION_MISMATCH);
      expect(d.failure.submitted).toBe(true);
    }
  });

  it('retries a retryable failure before the confirm click while attempts remain', () => {
    const result = {
      status: 'failed' as const,
      errorCode: BookingFailureCode.PLATFORM_UNAVAILABLE,
      message: 'timeout',
      submitted: false,
      retryable: true,
    };
    expect(decideSubmit(result, request, 1, 3).kind).toBe('retry');
    expect(decideSubmit(result, request, 2, 3).kind).toBe('retry');
    expect(decideSubmit(result, request, 3, 3).kind).toBe('failed');
  });

  it('never retries once the confirm click happened', () => {
    const d = decideSubmit(
      { status: 'failed', errorCode: BookingFailureCode.OUTCOME_UNKNOWN, message: 'no confirmation', submitted: true, retryable: true },
      request,
      1,
      3,
    );
    expect(d.kind).toBe('failed');
  });

  it('fails a challenge page straight away', () => {
    const d = decideSubmit(
      { status: 'failed', errorCode: BookingFailureCode.PLATFORM_BLOCKED, message: 'challenge', submitted: false, retryable: false },
      request,
      1,
      3,
    );
    expect(d).toMatchObject({ kind: 'failed', failure: { errorCode: BookingFailureCode.PLATFORM_BLOCKED, submitted: false } });
  });
});

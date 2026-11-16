/** BullMQ queue names shared by the api and worker apps. */
export const QUEUES = {
  SHIFTS: 'shifts',
  SUBMIT: 'submit',
  RESERVATION_WEBHOOK: 'reservation-webhook',
  AUDIT: 'audit',
  SCRIPT_REPAIR: 'script-repair',
} as const;

export type ScriptOperation = 'get_shifts' | 'submit';

/** Raised by a script failure; one repair runs per platform + operation (DESIGN.md §7.5). */
export interface ScriptRepairJobData {
  platform: string;
  operation: ScriptOperation;
  trigger: {
    errorCode: string;
    message: string;
    requestId: string;
    reservationId?: string;
    venueId?: string;
    occurredAt: string;
  };
}

export interface ShiftsJobData {
  requestId: string;
  platform: string;
  venueId: string;
  date: string;
  partySize: number;
}

export interface SubmitJobData {
  requestId: string;
  reservationId: string;
  /** AES-GCM encrypted Contact. Never the service token. */
  encryptedContact: string;
}

export interface ReservationWebhookJobData {
  eventId: string;
}

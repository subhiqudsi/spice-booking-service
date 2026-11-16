import { backoffMs, decideDelivery } from './delivery-policy';
import { signWebhook, verifyWebhook } from './webhook-signer';

const SECRET = 'w'.repeat(32);

describe('webhook signature', () => {
  const body = JSON.stringify({ event_id: 'evt_1', type: 'reservation.failed' });

  it('verifies what it signs', () => {
    const ts = 1_763_287_331;
    const signature = signWebhook(SECRET, ts, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhook(SECRET, { timestamp: String(ts), signature }, body, ts)).toBe(true);
  });

  it('rejects a changed body, wrong secret or old timestamp', () => {
    const ts = 1_763_287_331;
    const signature = signWebhook(SECRET, ts, body);
    expect(verifyWebhook(SECRET, { timestamp: String(ts), signature }, `${body} `, ts)).toBe(false);
    expect(verifyWebhook('x'.repeat(32), { timestamp: String(ts), signature }, body, ts)).toBe(false);
    expect(verifyWebhook(SECRET, { timestamp: String(ts), signature }, body, ts + 301)).toBe(false);
  });
});

describe('decideDelivery', () => {
  it('treats 2xx as delivered', () => {
    expect(decideDelivery(200, 1, 8)).toBe('delivered');
    expect(decideDelivery(204, 8, 8)).toBe('delivered');
  });

  it('gives up at once on permanent 4xx', () => {
    expect(decideDelivery(400, 1, 8)).toBe('dead');
    expect(decideDelivery(404, 1, 8)).toBe('dead');
  });

  it('retries 5xx, 408, 429 and network errors until attempts run out', () => {
    for (const status of [500, 503, 408, 429, null]) {
      expect(decideDelivery(status, 1, 8)).toBe('retry');
      expect(decideDelivery(status, 8, 8)).toBe('dead');
    }
  });
});

describe('backoffMs', () => {
  it('doubles from 30 s', () => {
    expect([1, 2, 3, 7].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 1_920_000]);
  });
});

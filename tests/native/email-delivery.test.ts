import { describe, expect, it } from 'vitest';

import { createSmtpDelivery } from '../../src/modules/identity/index.js';

/**
 * WP3-28 / T-18 — actual SMTP delivery against a disposable Mailpit server
 * (FR3-38: "simulated verify-email clicks do not pass the requirement").
 *
 * Native check, reported separately from the pure suite. Requires a
 * disposable Mailpit container, e.g.:
 * `docker run -d --name changeproof-mailpit -p 127.0.0.1:11025:1025
 * -p 127.0.0.1:18025:8025 axllent/mailpit:v1.27`
 * with MAILPIT_SMTP_URL=smtp://127.0.0.1:11025 and
 * MAILPIT_API_URL=http://127.0.0.1:18025. Fails closed without them.
 */

const smtpUrl = process.env['MAILPIT_SMTP_URL'];
const apiUrl = process.env['MAILPIT_API_URL'];
if (smtpUrl === undefined || smtpUrl.length === 0 || apiUrl === undefined || apiUrl.length === 0) {
  throw new Error(
    'MAILPIT_SMTP_URL and MAILPIT_API_URL are required (disposable Mailpit container). ' +
      'Start it first; see docs/phase-reports/phase-2.md.',
  );
}

const smtp = new URL(smtpUrl);
const smtpHost = smtp.hostname;
const smtpPort = Number.parseInt(smtp.port, 10);

interface MailpitAddress {
  readonly Address: string;
}

interface MailpitSummary {
  readonly ID: string;
  readonly To: readonly MailpitAddress[];
  readonly Subject: string;
}

async function mailpit(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`Mailpit API refused ${path}: HTTP ${response.status}.`);
  }
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    return body;
  } catch {
    return text;
  }
}

describe('actual email delivery over SMTP (FR3-38)', () => {
  it('delivers a verification-shaped message the server can show back', async () => {
    await mailpit('/api/v1/messages', { method: 'DELETE' });
    const delivery = createSmtpDelivery({
      host: smtpHost,
      port: smtpPort,
      sender: 'no-reply@changeproof.test',
      timeoutMs: 10_000,
    });
    const token = 'v1.dGVzdC10b2tlbg.test-signature';
    const receipt = await delivery.send({
      to: 'new-user@example.test',
      subject: 'Verify your ChangeProof email',
      textBody: `Your verification token is below. It can be used once.\n\nToken (single use, expires as stated):\n${token}\n`,
    });
    expect(receipt.messageId.length).toBeGreaterThan(0);

    const listing = (await mailpit('/api/v1/messages')) as { messages: MailpitSummary[] };
    expect(listing.messages).toHaveLength(1);
    expect(listing.messages[0]?.To.map((entry) => entry.Address)).toEqual(['new-user@example.test']);
    expect(listing.messages[0]?.Subject).toBe('Verify your ChangeProof email');
    const full = (await mailpit(`/api/v1/message/${listing.messages[0]?.ID}`)) as { Text: string };
    expect(full.Text).toContain(token);
  });

  it('refuses header injection instead of sending it', async () => {
    const delivery = createSmtpDelivery({
      host: smtpHost,
      port: smtpPort,
      sender: 'no-reply@changeproof.test',
      timeoutMs: 10_000,
    });
    await expect(
      delivery.send({
        to: 'victim@example.test\nBcc: attacker@example.test',
        subject: 'Verify',
        textBody: 'body',
      }),
    ).rejects.toThrow(/injection/i);
  });

  it('fails closed when no relay answers, claiming nothing', async () => {
    const delivery = createSmtpDelivery({
      host: '127.0.0.1',
      port: 9,
      sender: 'no-reply@changeproof.test',
      timeoutMs: 3_000,
    });
    await expect(
      delivery.send({ to: 'nobody@example.test', subject: 'Verify', textBody: 'body' }),
    ).rejects.toThrow(/failed|refused|timed out|closed/i);
  });
});

import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';

import {
  ChangeProofError,
  NonEmptyStringSchema,
  type EmailDeliveryPort,
  type EmailDeliveryReceipt,
  type EmailMessage,
} from '../../core/index.js';

/**
 * Minimal SMTP delivery client (WP3-28, FR3-38).
 *
 * Speaks plain SMTP (EHLO, MAIL FROM, RCPT TO, DATA, QUIT) to a configured
 * relay over `node:net` — no new dependency for a five-command exchange.
 * Replies are read through one persistent line reader (multi-line greetings
 * and TCP chunking handled), every reply code is checked, and a refusal,
 * timeout, or dropped connection fails closed with a specific error, never
 * a forged acceptance.
 *
 * shortcut: no TLS/auth/pipelining/chunking; upgrade to a qualified mail
 * vendor with authenticated submission before any production use.
 */

export interface SmtpDeliveryOptions {
  readonly host: string;
  readonly port: number;
  readonly sender: string;
  readonly timeoutMs: number;
}

function assertAscii(value: string, name: string): void {
  // eslint-disable-next-line no-control-regex
  if (!/^[\x09\x0A\x0D\x20-\x7E]*$/.test(value)) {
    throw new ChangeProofError(`${name} must be ASCII-only; refusing to send.`);
  }
}

/** One reader per connection: bytes are never lost between commands. */
function createLineReader(socket: Socket): {
  nextLine(): Promise<string>;
  failPending(cause: Error): void;
} {
  let buffer = '';
  const queued: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (cause: Error) => void }[] = [];
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('ascii');
    let end = buffer.indexOf('\r\n');
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const next = waiting.shift();
      if (next === undefined) {
        queued.push(line);
      } else {
        next.resolve(line);
      }
      end = buffer.indexOf('\r\n');
    }
  });
  return {
    nextLine(): Promise<string> {
      const ready = queued.shift();
      if (ready !== undefined) {
        return Promise.resolve(ready);
      }
      return new Promise<string>((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    failPending(cause: Error): void {
      let next = waiting.shift();
      while (next !== undefined) {
        next.reject(cause);
        next = waiting.shift();
      }
    },
  };
}

export function createSmtpDelivery(options: SmtpDeliveryOptions): EmailDeliveryPort {
  const host = NonEmptyStringSchema.parse(options.host);
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65_535) {
    throw new ChangeProofError('SMTP port must be a valid TCP port; refusing.');
  }
  const sender = NonEmptyStringSchema.parse(options.sender);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ChangeProofError('SMTP timeout must be a positive duration; refusing.');
  }

  return {
    async send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
      const to = NonEmptyStringSchema.parse(message.to);
      const subject = NonEmptyStringSchema.parse(message.subject);
      const textBody = NonEmptyStringSchema.parse(message.textBody);
      assertAscii(to, 'Recipient');
      assertAscii(subject, 'Subject');
      assertAscii(textBody, 'Body');
      if (to.includes('\n') || to.includes('\r') || subject.includes('\n') || subject.includes('\r')) {
        throw new ChangeProofError('Header injection attempt in recipient or subject; refusing to send.');
      }
      const messageId = `<${randomBytes(16).toString('hex')}@changeproof>`;
      // Dot-stuffing per RFC 5321 §4.5.2 so body lines never end DATA early.
      const stuffed = textBody
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .map((line) => (line.startsWith('.') ? `.${line}` : line))
        .join('\r\n');
      const data = [
        `From: ${sender}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Message-ID: ${messageId}`,
        'Content-Type: text/plain; charset=us-ascii',
        '',
        stuffed,
        '.',
      ].join('\r\n');

      const socket = new Socket();
      socket.setTimeout(options.timeoutMs);
      const reader = createLineReader(socket);
      const dead = (message: string): ChangeProofError => new ChangeProofError(`${message}; nothing was delivered.`);
      socket.on('timeout', () => {
        reader.failPending(dead('SMTP relay timed out'));
        socket.destroy();
      });
      socket.on('error', (cause: unknown) => {
        reader.failPending(dead(`SMTP connection failed (${cause instanceof Error ? cause.message : 'unknown cause'})`));
      });
      socket.on('close', () => {
        reader.failPending(dead('SMTP connection closed mid-exchange'));
      });

      async function exchange(line: string | null, expectCodes: readonly number[]): Promise<void> {
        if (line !== null) {
          socket.write(`${line}\r\n`, 'ascii');
        }
        // Multi-line replies run to the code-plus-space final line.
        let reply = await reader.nextLine();
        while (/^\d{3}-/.test(reply)) {
          reply = await reader.nextLine();
        }
        const code = Number.parseInt(reply.slice(0, 3), 10);
        if (!Number.isInteger(code) || !expectCodes.includes(code)) {
          throw dead(`SMTP relay refused the exchange (reply: ${reply.slice(0, 80)})`);
        }
      }

      try {
        await new Promise<void>((resolve, reject) => {
          socket.connect(options.port, host, () => {
            resolve();
          });
          socket.once('error', (cause: unknown) => {
            reject(
              dead(`SMTP connection failed (${cause instanceof Error ? cause.message : 'unknown cause'})`),
            );
          });
        });
        await exchange(null, [220]);
        await exchange(`EHLO changeproof`, [250]);
        await exchange(`MAIL FROM:<${sender}>`, [250]);
        await exchange(`RCPT TO:<${to}>`, [250, 251]);
        await exchange('DATA', [354]);
        await exchange(data, [250]);
        await exchange('QUIT', [221]);
      } finally {
        socket.destroy();
      }
      return { messageId, acceptedAt: new Date().toISOString() };
    },
  };
}

import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SamlAssertionSchema,
  SamlConnectionSchema,
  type SamlAssertion,
  type SamlConnection,
} from '../../src/core/index.js';
import {
  fingerprintCert,
  validateSamlAssertion,
  verifySamlSignature,
} from '../../src/modules/identity/index.js';

/**
 * WP3-32 / T-32 — SAML validation failure-path tests (NEG3-38).
 *
 * Written before the implementation. Issuer, audience, destination, request
 * correlation, and the validity window are pinned to the connection record;
 * signatures are real RSA-SHA256 over the signed bytes (no XML-DSig stub
 * that always says yes); and a certificate that does not parse is refused
 * before anything trusts it.
 */

const NOW = '2026-11-02T00:00:00.000Z';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { publicKey: otherPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT_PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const OTHER_CERT_PEM = otherPublicKey.export({ format: 'pem', type: 'spki' }).toString();

function signContent(content: string): { signedContentB64: string; signatureB64: string } {
  const bytes = Buffer.from(content, 'utf8');
  return {
    signedContentB64: bytes.toString('base64'),
    signatureB64: sign('sha256', bytes, privateKey).toString('base64'),
  };
}

function connection(overrides: Partial<SamlConnection> = {}): SamlConnection {
  return SamlConnectionSchema.parse({
    schemaVersion: '1',
    tenantId: 'tenant-a',
    entityId: 'https://changeproof.example.com/saml/metadata',
    idpIssuer: 'https://idp.example.com/metadata',
    audience: 'https://changeproof.example.com/saml/metadata',
    acsUrl: 'https://changeproof.example.com/saml/acs',
    certPem: CERT_PEM,
    certFingerprint: fingerprintCert(CERT_PEM),
    verifiedDomain: 'example.com',
    status: 'active',
    createdAt: NOW,
    rotatedAt: NOW,
    ...overrides,
  });
}

function assertion(overrides: Partial<SamlAssertion> = {}): SamlAssertion {
  return SamlAssertionSchema.parse({
    schemaVersion: '1',
    assertionId: 'assertion-1',
    issuer: 'https://idp.example.com/metadata',
    audience: 'https://changeproof.example.com/saml/metadata',
    destination: 'https://changeproof.example.com/saml/acs',
    subject: 'subject-persistent-1',
    email: 'user@example.com',
    authnInstant: NOW,
    notBefore: '2026-11-01T23:59:00.000Z',
    notOnOrAfter: '2026-11-02T00:05:00.000Z',
    requestId: 'request-1',
    ...signContent('assertion-1|subject-persistent-1|2026-11-02T00:05:00.000Z'),
    ...overrides,
  });
}

describe('SAML claim validation (NEG3-38)', () => {
  it('accepts an assertion that matches the pinned connection', () => {
    expect(validateSamlAssertion({ connection: connection(), assertion: assertion(), expectedRequestId: 'request-1', nowIso: NOW })).toMatchObject({
      subject: 'subject-persistent-1',
    });
  });

  it('rejects a wrong issuer, audience, or destination without saying which tenant owns what', () => {
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion({ issuer: 'https://evil.example.com/metadata' }),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/issuer/);
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion({ audience: 'https://someone-else.example.com/saml' }),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/audience/);
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion({ destination: 'https://evil.example.com/acs' }),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/destination/);
  });

  it('rejects a response that answers a different request', () => {
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion({ requestId: 'request-attacker' }),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/request/);
  });

  it('rejects assertions outside their validity window or from the future', () => {
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion(),
        expectedRequestId: 'request-1',
        nowIso: '2026-11-02T00:06:00.000Z',
      }),
    ).toThrow(/expired|validity/);
    expect(() =>
      validateSamlAssertion({
        connection: connection(),
        assertion: assertion({ authnInstant: '2026-11-02T01:00:00.000Z' }),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/future/);
  });

  it('rejects every assertion while the connection is disabled', () => {
    expect(() =>
      validateSamlAssertion({
        connection: connection({ status: 'disabled' }),
        assertion: assertion(),
        expectedRequestId: 'request-1',
        nowIso: NOW,
      }),
    ).toThrow(/disabled/);
  });
});

describe('SAML signature verification (NEG3-38)', () => {
  it('accepts a genuine RSA signature and rejects tampered bytes', () => {
    const valid = assertion();
    expect(() => {
      verifySamlSignature({
        certPem: CERT_PEM,
        signedContentB64: valid.signedContentB64,
        signatureB64: valid.signatureB64,
      });
    }).not.toThrow();
    expect(() => {
      verifySamlSignature({
        certPem: CERT_PEM,
        signedContentB64: Buffer.from('tampered', 'utf8').toString('base64'),
        signatureB64: valid.signatureB64,
      });
    }).toThrow(/signature/);
  });

  it('rejects a signature made for a different certificate', () => {
    const valid = assertion();
    expect(() => {
      verifySamlSignature({
        certPem: OTHER_CERT_PEM,
        signedContentB64: valid.signedContentB64,
        signatureB64: valid.signatureB64,
      });
    }).toThrow(/signature/);
  });

  it('refuses a certificate that does not parse instead of trusting it', () => {
    expect(() => fingerprintCert('not-a-certificate')).toThrow(/certificate/);
    const first = fingerprintCert(CERT_PEM);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintCert(CERT_PEM)).toBe(first);
    expect(fingerprintCert(OTHER_CERT_PEM)).not.toBe(first);
  });
});

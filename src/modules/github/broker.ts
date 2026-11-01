import { ChangeProofError, type SecretBrokerPort } from '../../core/index.js';

/**
 * Injected-map secret broker (WP3-22, FR3-30).
 *
 * The composition root builds this with the runtime secret map; tests build it
 * with fakes. Reads are exact-match by ref and fail closed on unknown/empty —
 * there is no default credential. Values are never logged and never enter
 * errors. The production broker (vault/KMS, rotation, audit) is a vendor
 * decision that arrives behind the same stable port.
 */
export function createMapSecretBroker(secrets: ReadonlyMap<string, string>): SecretBrokerPort {
  return {
    readCredential: (refId: string): Promise<string> => {
      if (refId.length === 0) {
        return Promise.reject(new ChangeProofError('Credential ref is empty; refusing to read.'));
      }
      const value = secrets.get(refId);
      if (value === undefined || value.length === 0) {
        return Promise.reject(new ChangeProofError('Credential ref is unknown or missing; refusing a default.'));
      }
      return Promise.resolve(value);
    },
  };
}

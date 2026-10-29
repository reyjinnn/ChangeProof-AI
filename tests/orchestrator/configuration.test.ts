import { describe, expect, it } from 'vitest';

import { MissingConfigurationError } from '../../src/core/index.js';
import {
  CompositeConfiguration,
  EnvironmentConfiguration,
  requireAll,
} from '../../src/orchestrator/configuration.js';

/** WP3-02 / NFR3-08: missing config is an explicit error, never a default. */
describe('EnvironmentConfiguration', () => {
  it('returns a value that was explicitly provided', () => {
    const config = new EnvironmentConfiguration('test', { RUNNER_IMAGE: 'sha256:' + 'a'.repeat(64) });
    expect(config.require('RUNNER_IMAGE')).toBe('sha256:' + 'a'.repeat(64));
  });

  it('raises an actionable typed error for a missing required key', () => {
    const config = new EnvironmentConfiguration('test', {});
    let caught: unknown;
    try {
      config.require('MODEL_CREDENTIAL_REF');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingConfigurationError);
    expect((caught as MissingConfigurationError).key).toBe('MODEL_CREDENTIAL_REF');
    expect((caught as MissingConfigurationError).message).toContain('test');
  });

  it('does not treat an empty string as a configured value', () => {
    const config = new EnvironmentConfiguration('test', { RUNNER_IMAGE: '' });
    expect(() => config.require('RUNNER_IMAGE')).toThrow(MissingConfigurationError);
  });

  it('optional lookup returns null when absent, not a made-up default', () => {
    const config = new EnvironmentConfiguration('test', {});
    expect(config.optional('DATABASE_URL')).toBeNull();
  });
});

describe('CompositeConfiguration', () => {
  it('uses the first source that has the key', () => {
    const config = new CompositeConfiguration([
      new EnvironmentConfiguration('environment', { LOG_LEVEL: 'debug' }),
      new EnvironmentConfiguration('file', { LOG_LEVEL: 'info', RUNNER_IMAGE: 'image@sha256:' + 'a'.repeat(64) }),
    ]);
    expect(config.require('LOG_LEVEL')).toBe('debug');
    expect(config.require('RUNNER_IMAGE')).toBe('image@sha256:' + 'a'.repeat(64));
  });

  it('fails when no source provides the key', () => {
    const config = new CompositeConfiguration([
      new EnvironmentConfiguration('environment', {}),
      new EnvironmentConfiguration('file', {}),
    ]);
    expect(() => config.require('CHECK_MAP')).toThrow(MissingConfigurationError);
  });
});

describe('requireAll', () => {
  it('returns every value when all required keys are present', () => {
    const config = new EnvironmentConfiguration('test', { A: '1', B: '2' });
    expect(requireAll(config, ['A', 'B'])).toEqual({ A: '1', B: '2' });
  });

  it('lists all missing keys before a run starts', () => {
    const config = new EnvironmentConfiguration('test', { A: '1' });
    let caught: unknown;
    try {
      requireAll(config, ['A', 'B', 'C']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingConfigurationError);
    expect((caught as MissingConfigurationError).key).toBe('B, C');
    expect((caught as MissingConfigurationError).message).toContain('2 required value(s)');
  });
});

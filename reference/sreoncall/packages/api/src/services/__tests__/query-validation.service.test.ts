import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delegate to the real Lezer parsers by default (so most tests exercise real grammars),
// but expose a controllable spy so the fail-open tests can make the SUT's own
// parser.parse() call throw — not a mock that's never actually invoked by the SUT.
// Note: the spies MUST be created via vi.hoisted() — vi.mock() factories are hoisted
// above ordinary top-level `const`s, so a plain `const logqlParseSpy = vi.fn()` above
// vi.mock() throws "Cannot access before initialization" once the factory runs.
const { logqlParseSpy, promqlParseSpy } = vi.hoisted(() => ({
  logqlParseSpy: vi.fn(),
  promqlParseSpy: vi.fn(),
}));

vi.mock('@grafana/lezer-logql', async (importOriginal) => {
  const actual = await importOriginal<any>();
  logqlParseSpy.mockImplementation((q: string) => actual.parser.parse(q));
  return { ...actual, parser: { ...actual.parser, parse: (q: string) => logqlParseSpy(q) } };
});

vi.mock('@prometheus-io/lezer-promql', async (importOriginal) => {
  const actual = await importOriginal<any>();
  promqlParseSpy.mockImplementation((q: string) => actual.parser.parse(q));
  return { ...actual, parser: { ...actual.parser, parse: (q: string) => promqlParseSpy(q) } };
});

const warn = vi.fn();
vi.mock('../../utils/logger', () => ({ logger: { warn: (...a: any[]) => warn(...a), info: vi.fn(), error: vi.fn() } }));

import { validateLogQL, validatePromQL } from '../query-validation.service';

beforeEach(() => {
  warn.mockReset();
});

describe('validateLogQL', () => {
  it('accepts valid LogQL with chained line filters', () => {
    expect(validateLogQL('{service_name="api"} |= "error" != "admin"')).toEqual({ valid: true });
  });

  it('rejects a nested double-quote that breaks the line filter', () => {
    const result = validateLogQL('{service_name="authlog"} |= "Disconnected from "invalid user""');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/syntax error near position \d+/);
  });

  it('rejects an unbalanced stream selector', () => {
    const result = validateLogQL('{service_name="api"');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/syntax error/);
  });

  it('fails open when the parser itself throws — never throws, returns valid:true, warns', () => {
    logqlParseSpy.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    let result: ReturnType<typeof validateLogQL> | undefined;
    expect(() => {
      result = validateLogQL('{service_name="api"}');
    }).not.toThrow();
    expect(result).toEqual({ valid: true });
    expect(warn).toHaveBeenCalled();
  });
});

describe('validatePromQL', () => {
  it('accepts valid PromQL', () => {
    expect(validatePromQL('rate(http_x[5m])')).toEqual({ valid: true });
  });

  it('rejects an unbalanced function call', () => {
    const result = validatePromQL('rate(http_x[5m]');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/syntax error/);
  });

  it('fails open when the parser itself throws — never throws, returns valid:true, warns', () => {
    promqlParseSpy.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    let result: ReturnType<typeof validatePromQL> | undefined;
    expect(() => {
      result = validatePromQL('rate(x[5m])');
    }).not.toThrow();
    expect(result).toEqual({ valid: true });
    expect(warn).toHaveBeenCalled();
  });
});

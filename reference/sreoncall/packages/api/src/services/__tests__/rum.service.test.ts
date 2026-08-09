import { describe, expect, it } from 'vitest';
import { buildRumSummary, parseRumLogLine } from '../rum.service';

describe('parseRumLogLine', () => {
  it('extracts vitals, errors, browser, session, and path from nested json', () => {
    const parsed = parseRumLogLine(
      JSON.stringify({
        browser: { name: 'Chrome' },
        page: { url: 'https://app.example.com/incidents/123' },
        session: { session_id: 'sess-1' },
        measurements: [
          { name: 'LCP', value: 1800 },
          { name: 'CLS', value: 0.08 },
        ],
        exceptions: [{ message: 'boom' }],
      }),
      String(1_720_000_000_000_000_000n),
    );

    expect(parsed).toMatchObject({
      browser: 'Chrome',
      sessionId: 'sess-1',
      urlPath: '/incidents/123',
      hasError: true,
    });
    expect(parsed?.measurements).toEqual([
      { name: 'lcp', value: 1800 },
      { name: 'cls', value: 0.08 },
    ]);
  });

  it('extracts web vitals and page-load data from logfmt faro lines', () => {
    const vitals = parseRumLogLine(
      'timestamp="2026-06-23 10:22:04.405 +0000 UTC" kind=measurement type=web-vitals inp=96.000000 value_inp=96 app_name=sreoncall-web session_id=GsQi1kEigH page_url=https://dev-web.sreoncall.com/observability/rum browser_name=Chrome',
      String(1_782_210_124_489_736_995n),
    );
    const resource = parseRumLogLine(
      'timestamp="2026-06-23 10:22:00.445 +0000 UTC" kind=event event_name=faro.performance.resource event_data_duration=31 event_data_name=https://dev-web.sreoncall.com/api/v1/dashboard/stats session_id=GsQi1kEigH page_url=https://dev-web.sreoncall.com/observability/rum browser_name=Chrome',
      String(1_782_210_120_698_684_718n),
    );

    expect(vitals).toMatchObject({
      browser: 'Chrome',
      sessionId: 'GsQi1kEigH',
      urlPath: '/observability/rum',
      hasError: false,
    });
    expect(vitals?.measurements).toEqual([{ name: 'inp', value: 96 }]);

    expect(resource?.measurements).toEqual([
      { name: 'page_load', value: 31, urlPath: '/api/v1/dashboard/stats' },
    ]);
  });
});

describe('buildRumSummary', () => {
  it('aggregates time series and tables from mixed faro logs', () => {
    const minute1 = String(1_720_000_000_000_000_000n);
    const minute2 = String(1_720_000_060_000_000_000n);

    const summary = buildRumSummary([
      {
        timestampNs: minute1,
        line: JSON.stringify({
          browser: { name: 'Chrome' },
          page: { url: 'https://app.example.com/' },
          session: { session_id: 's1' },
          measurements: [
            { name: 'LCP', value: 1200 },
            { name: 'INP', value: 110 },
            { name: 'CLS', value: 0.04 },
            { name: 'page_load', value: 900 },
          ],
        }),
      },
      {
        timestampNs: minute1,
        line: JSON.stringify({
          browser: { name: 'Firefox' },
          page: { url: 'https://app.example.com/' },
          session: { session_id: 's2' },
          exceptions: [{ message: 'TypeError' }],
        }),
      },
      {
        timestampNs: minute2,
        line: JSON.stringify({
          browser: { name: 'Chrome' },
          page: { url: 'https://app.example.com/settings' },
          session: { session_id: 's3' },
          metric: 'page-load',
          value: 1500,
        }),
      },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.lcp).toBe(1200);
    expect(summary.inp).toBe(110);
    expect(summary.cls).toBe(0.04);
    expect(summary.pageLoad[0]).toEqual({ url_path: '/settings', value: 1500 });
    expect(summary.pageLoad[1]).toEqual({ url_path: '/', value: 900 });
    expect(summary.browsers).toEqual([
      { name: 'Chrome', value: 2 },
      { name: 'Firefox', value: 1 },
    ]);
    expect(summary.jsErrors.reduce((sum, point) => sum + point.value, 0)).toBe(1);
    expect(summary.sessions.reduce((sum, point) => sum + point.value, 0)).toBe(3);
  });

  it('aggregates logfmt faro measurements into summary cards', () => {
    const summary = buildRumSummary([
      {
        timestampNs: String(1_782_210_124_489_736_995n),
        line: 'timestamp="2026-06-23 10:22:04.405 +0000 UTC" kind=measurement type=web-vitals lcp=1800.5 inp=96.000000 cls=0.03 session_id=GsQi1kEigH page_url=https://dev-web.sreoncall.com/observability/rum browser_name=Chrome',
      },
      {
        timestampNs: String(1_782_210_120_698_684_718n),
        line: 'timestamp="2026-06-23 10:22:00.445 +0000 UTC" kind=event event_name=faro.performance.resource event_data_duration=31 event_data_name=https://dev-web.sreoncall.com/api/v1/dashboard/stats session_id=GsQi1kEigH page_url=https://dev-web.sreoncall.com/observability/rum browser_name=Chrome',
      },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.lcp).toBe(1800.5);
    expect(summary.inp).toBe(96);
    expect(summary.cls).toBe(0.03);
    expect(summary.pageLoad[0]).toEqual({ url_path: '/api/v1/dashboard/stats', value: 31 });
    expect(summary.browsers).toEqual([{ name: 'Chrome', value: 1 }]);
    expect(summary.samples).toBe(2);
  });
});

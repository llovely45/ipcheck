import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiPath = resolve(projectRoot, 'static/api.js');

function loadApi(fetchImpl = async () => {
    throw new Error('Unexpected network request in test');
}) {
    if (!existsSync(apiPath)) return null;

    const window = { fetch: fetchImpl };
    const context = {
        window,
        console,
        encodeURIComponent,
        setTimeout,
        clearTimeout,
        AbortController,
    };
    context.globalThis = context;
    vm.runInNewContext(readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
    return window.IPCheckAPI;
}

function response(body, { status = 200, headers = {} } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        json: async () => body,
        text: async () => body,
    };
}

test('exposes a browser-safe API client', () => {
    assert.ok(loadApi(), 'static/api.js should expose window.IPCheckAPI');
});

test('normalizes the current ipwho.is response into the page data shape', () => {
    const api = loadApi();
    assert.ok(api);

    const normalized = api.normalizeIpWhoIs({
        success: true,
        ip: '1.1.1.1',
        city: 'Sydney',
        region: 'New South Wales',
        country: 'Australia',
        country_code: 'AU',
        latitude: -33.8688,
        longitude: 151.209,
        timezone: { id: 'Australia/Sydney' },
        connection: {
            asn: 13335,
            org: 'Cloudflare, Inc.',
            isp: 'Cloudflare, Inc.',
            domain: 'cloudflare.com',
        },
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        ip: '1.1.1.1',
        city: 'Sydney',
        region: 'New South Wales',
        country: 'Australia',
        countryCode: 'AU',
        latitude: -33.8688,
        longitude: 151.209,
        timezone: 'Australia/Sydney',
        organization: 'Cloudflare, Inc.',
        isp: 'Cloudflare, Inc.',
        asn: 'AS13335',
        domain: 'cloudflare.com',
    });
});

test('normalizes the new anonymous ipapi.is response without inventing risk flags', () => {
    const api = loadApi();
    assert.ok(api);

    const normalized = api.normalizeIpapiIs({
        ip: '8.8.8.8',
        is_bogon: false,
        company: 'Google LLC',
        asn: 'AS15169 Google LLC',
        city: 'Mountain View',
        region: 'California',
        country: 'United States',
        lat: 37.422,
        lon: -122.085,
        timezone: 'America/Los_Angeles',
    });

    assert.equal(normalized.ip, '8.8.8.8');
    assert.equal(normalized.organization, 'Google LLC');
    assert.equal(normalized.asn, 'AS15169');
    assert.equal(normalized.city, 'Mountain View');
    assert.equal(normalized.region, 'California');
    assert.equal(normalized.timezone, 'America/Los_Angeles');
    assert.equal(normalized.isBogon, false);
    assert.equal(normalized.riskDataAvailable, false);
});

test('parses the free blackbox reputation response as an aggregate decision', () => {
    const api = loadApi();
    assert.ok(api);

    assert.deepEqual(JSON.parse(JSON.stringify(api.parseBlackboxDecision('N'))), {
        decision: 'allow',
        score: null,
        detectionAvailable: true,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(api.parseBlackboxDecision('Y\n'))), {
        decision: 'block',
        score: null,
        detectionAvailable: true,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(api.parseBlackboxDecision('E'))), {
        decision: 'unknown',
        score: null,
        detectionAvailable: false,
    });
});

test('masks the final two IPv4 or IPv6 components without changing placeholders', () => {
    const api = loadApi();
    assert.ok(api);

    assert.equal(api.maskIp('203.0.113.8'), '203.0.*.*');
    assert.equal(
        api.maskIp('2001:0db8:0000:0000:0000:0000:0000:0001'),
        '2001:0db8:0000:0000:0000:0000:*:*'
    );
    assert.equal(api.maskIp('::ffff:192.0.2.1'), '::ffff:192.0.*.*');
    assert.equal(api.maskIp('Loading...'), 'Loading...');
    assert.equal(api.maskIp('Connection Failed'), 'Connection Failed');
});

test('normalizes ipinfo widget privacy fields into a scored risk source', () => {
    const api = loadApi();
    assert.ok(api);

    const source = api.parseIpinfoPrivacyResponse({
        data: {
            ip: '8.8.8.8',
            privacy: {
                vpn: false,
                proxy: false,
                tor: false,
                relay: false,
                hosting: true,
            },
            is_anonymous: false,
            is_hosting: true,
        },
    });

    assert.equal(source.ip, '8.8.8.8');
    assert.equal(source.score, 70);
    assert.equal(source.decision, 'allow');
    assert.deepEqual(JSON.parse(JSON.stringify(source.flags)), ['托管/数据中心']);
    assert.equal(source.status, 'available');
});

test('normalizes freeipapi proxy flag without inventing VPN or Tor results', () => {
    const api = loadApi();
    assert.ok(api);

    const source = api.parseFreeIpApiRisk({
        ipAddress: '203.0.113.8',
        isProxy: true,
    });

    assert.equal(source.ip, '203.0.113.8');
    assert.equal(source.score, 15);
    assert.equal(source.decision, 'block');
    assert.deepEqual(JSON.parse(JSON.stringify(source.flags)), ['Proxy']);
    assert.equal(source.status, 'available');
});

test('aggregates only scored sources and reports weighted coverage', () => {
    const api = loadApi();
    assert.ok(api);

    const aggregate = api.aggregatePurityScores([
        { id: 'ipinfo', provider: 'ipinfo.io', weight: 0.45, score: 70, status: 'available', decision: 'allow' },
        { id: 'blackbox', provider: 'blackbox.ipinfo.app', weight: 0.35, score: 90, status: 'available', decision: 'allow' },
        { id: 'freeipapi', provider: 'freeipapi.com', weight: 0.20, score: null, status: 'unavailable', decision: 'unknown' },
    ]);

    assert.equal(aggregate.score, 79);
    assert.equal(aggregate.sourceCount, 2);
    assert.equal(aggregate.totalSourceCount, 3);
    assert.equal(aggregate.coverage, 80);
    assert.equal(aggregate.classification, 'good');
});

test('does not invent a purity score when every risk source is unavailable', () => {
    const api = loadApi();
    assert.ok(api);

    const aggregate = api.aggregatePurityScores([
        { id: 'blackbox', provider: 'blackbox.ipinfo.app', weight: 0.35, score: null, status: 'unavailable', decision: 'unknown' },
        { id: 'ipinfo', provider: 'ipinfo.io', weight: 0.45, score: null, status: 'unavailable', decision: 'unknown' },
    ]);

    assert.equal(aggregate.score, null);
    assert.equal(aggregate.sourceCount, 0);
    assert.equal(aggregate.totalSourceCount, 2);
    assert.equal(aggregate.coverage, 0);
    assert.equal(aggregate.classification, 'unknown');
});

test('queries every configured risk source with the original unmasked IP', async () => {
    const calls = [];
    const api = loadApi(async (url) => {
        calls.push(url);
        if (url === 'https://blackbox.ipinfo.app/api/v1/203.0.113.8') return response('N');
        if (url === 'https://ipinfo.io/widget/demo/203.0.113.8') {
            return response({
                data: {
                    ip: '203.0.113.8',
                    privacy: { vpn: false, proxy: false, tor: false, relay: false, hosting: false },
                    is_anonymous: false,
                    is_hosting: false,
                },
            });
        }
        if (url === 'https://free.freeipapi.com/api/json/203.0.113.8') {
            return response({ ipAddress: '203.0.113.8', isProxy: false });
        }
        throw new Error(`Unexpected URL: ${url}`);
    });
    assert.ok(api);

    const risk = await api.getRiskData('203.0.113.8');

    assert.equal(risk.score, 92);
    assert.equal(risk.coverage, 100);
    assert.equal(risk.sourceCount, 3);
    assert.deepEqual(calls, [
        'https://blackbox.ipinfo.app/api/v1/203.0.113.8',
        'https://ipinfo.io/widget/demo/203.0.113.8',
        'https://free.freeipapi.com/api/json/203.0.113.8',
    ]);
});

test('parses Cloudflare Trace key/value data without truncating values', () => {
    const api = loadApi();
    assert.ok(api);

    assert.deepEqual(JSON.parse(JSON.stringify(api.parseTrace('http=http/2\ntls=TLSv1.3\nempty=\n'))), {
        http: 'http/2',
        tls: 'TLSv1.3',
        empty: '',
    });
});

test('normalizes the free geolocation fallback response', () => {
    const api = loadApi();
    assert.ok(api);

    const normalized = api.normalizeFreeIpApi({
        ipVersion: 4,
        ipAddress: '8.8.8.8',
        latitude: 37.422,
        longitude: -122.085,
        countryName: 'United States',
        countryCode: 'US',
        cityName: 'Mountain View',
        regionName: 'California',
        timeZones: ['America/Los_Angeles'],
        asn: '15169',
        asnOrganization: 'Google LLC',
        isProxy: false,
    });

    assert.equal(normalized.ip, '8.8.8.8');
    assert.equal(normalized.asn, 'AS15169');
    assert.equal(normalized.organization, 'Google LLC');
    assert.equal(normalized.timezone, 'America/Los_Angeles');
    assert.equal(normalized.isProxy, false);
});

test('falls back from ipwho.is to ipapi.is after an HTTP failure', async () => {
    const calls = [];
    const api = loadApi(async (url) => {
        calls.push(url);
        if (url.startsWith('https://ipwho.is/')) return response('unavailable', { status: 503 });
        if (url.startsWith('https://api.ipapi.is/')) {
            return response({
                ip: '8.8.8.8',
                is_bogon: false,
                company: 'Google LLC',
                asn: 'AS15169 Google LLC',
                city: 'Mountain View',
                region: 'California',
                country: 'United States',
                lat: 37.422,
                lon: -122.085,
                timezone: 'America/Los_Angeles',
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    });
    assert.ok(api);

    const normalized = await api.getGeoData('8.8.8.8');

    assert.equal(normalized.ip, '8.8.8.8');
    assert.equal(normalized.organization, 'Google LLC');
    assert.deepEqual(calls, [
        'https://ipwho.is/8.8.8.8',
        'https://api.ipapi.is/?q=8.8.8.8',
    ]);
});

test('falls back from the first ipify endpoint to the JSON-compatible secondary endpoint', async () => {
    const calls = [];
    const api = loadApi(async (url) => {
        calls.push(url);
        if (url === 'https://api.ipify.org?format=json') return response('blocked', { status: 429 });
        if (url === 'https://api64.ipify.org?format=json') return response({ ip: '203.0.113.8' });
        throw new Error(`Unexpected URL: ${url}`);
    });
    assert.ok(api);

    assert.equal(await api.getForeignIp(), '203.0.113.8');
    assert.deepEqual(calls, [
        'https://api.ipify.org?format=json',
        'https://api64.ipify.org?format=json',
    ]);
});

test('keeps a usable profile when reputation lookup is unavailable', async () => {
    const api = loadApi(async (url) => {
        if (url === 'https://ipwho.is/8.8.8.8') {
            return response({
                success: true,
                ip: '8.8.8.8',
                city: 'Mountain View',
                region: 'California',
                country: 'United States',
                country_code: 'US',
                latitude: 37.422,
                longitude: -122.085,
                timezone: { id: 'America/Los_Angeles' },
                connection: { asn: 15169, org: 'Google LLC', isp: 'Google LLC' },
            });
        }
        if (url.startsWith('https://blackbox.ipinfo.app/')) return response('unavailable', { status: 503 });
        throw new Error(`Unexpected URL: ${url}`);
    });
    assert.ok(api);

    const profile = await api.getProfile('8.8.8.8');
    assert.equal(profile.geo.ip, '8.8.8.8');
    assert.equal(profile.risk.score, null);
    assert.equal(profile.risk.coverage, 0);
    assert.equal(profile.risk.sourceCount, 0);
});

test('rejects non-success responses instead of parsing error pages as data', async () => {
    const api = loadApi(async () => response('<html>blocked</html>', { status: 403 }));
    assert.ok(api);

    await assert.rejects(
        () => api.requestJson('https://example.invalid/data'),
        /HTTP 403/
    );
});

test('does not retain the retired IP providers in active source files', () => {
    assert.ok(existsSync(apiPath), 'static/api.js should exist before scanning active sources');
    const activeSource = [
        readFileSync(resolve(projectRoot, 'static/api.js'), 'utf8'),
        readFileSync(resolve(projectRoot, 'static/app.js'), 'utf8'),
    ].join('\n');

    assert.doesNotMatch(activeSource, /https?:\/\/(?:api\.)?ipapi\.co(?:[/'"`]|$)|https?:\/\/ip\.useragentinfo\.com|https?:\/\/api\.ip\.sb/);
});

test('pins Babel to the UMD-compatible 7.x runtime', () => {
    const indexSource = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
    assert.match(indexSource, /@babel\/standalone@7\.28\.4\/babel\.min\.js/);
});

test('uses presentation-only IP masking and card reveal interactions in the active page', () => {
    const appSource = readFileSync(resolve(projectRoot, 'static/app.js'), 'utf8');

    assert.match(appSource, /maskIp/);
    assert.match(appSource, /onMouseEnter/);
    assert.match(appSource, /onMouseLeave/);
    assert.match(appSource, /onFocus/);
    assert.match(appSource, /onBlur/);
    assert.match(appSource, /getProfile\(ip\)/);
});

test('renders multi-source risk details and weighted coverage in the active page', () => {
    const appSource = readFileSync(resolve(projectRoot, 'static/app.js'), 'utf8');

    assert.match(appSource, /risk\.sources/);
    assert.match(appSource, /risk\.coverage/);
    assert.match(appSource, /risk\.basis/);
    assert.match(appSource, /source\.weight/);
});

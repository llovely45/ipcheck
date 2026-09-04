(function (global) {
    const REQUEST_TIMEOUT_MS = 12000;
    const API_ENDPOINTS = Object.freeze({
        geo: Object.freeze({
            ipwho: (ip) => ip
                ? `https://ipwho.is/${encodeURIComponent(ip)}`
                : 'https://ipwho.is/',
            ipapi: (ip) => ip
                ? `https://api.ipapi.is/?q=${encodeURIComponent(ip)}`
                : 'https://api.ipapi.is/',
            freeIpApi: (ip) => ip
                ? `https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`
                : 'https://free.freeipapi.com/api/json/'
        }),
        trace: 'https://www.cloudflare.com/cdn-cgi/trace',
        domesticIp: 'https://myip.ipip.net/json',
        foreignIp: Object.freeze([
            'https://api.ipify.org?format=json',
            'https://api64.ipify.org?format=json'
        ]),
        dualStack: Object.freeze({
            v4: 'https://api.ipify.org?format=json',
            v6: 'https://api6.ipify.org?format=json'
        }),
        reputation: (ip) => `https://blackbox.ipinfo.app/api/v1/${encodeURIComponent(ip)}`
    });

    const textOrEmpty = (value) => value === undefined || value === null ? '' : String(value).trim();

    const numberOrNull = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };

    const normalizeAsn = (value) => {
        const text = textOrEmpty(value);
        if (!text) return '';
        if (/^\d+$/.test(text)) return `AS${text}`;
        const match = text.match(/\bAS\s*(\d+)\b/i);
        return match ? `AS${match[1]}` : text;
    };

    const assertIpResponse = (payload, provider) => {
        if (!payload || typeof payload !== 'object' || !textOrEmpty(payload.ip)) {
            throw new Error(`${provider} returned no IP data`);
        }
        return payload;
    };

    const normalizeIpWhoIs = (payload) => {
        assertIpResponse(payload, 'ipwho.is');
        if (payload.success === false) throw new Error('ipwho.is reported an unsuccessful lookup');

        const connection = payload.connection && typeof payload.connection === 'object'
            ? payload.connection
            : {};
        const timezone = payload.timezone && typeof payload.timezone === 'object'
            ? payload.timezone.id
            : payload.timezone;

        return {
            ip: textOrEmpty(payload.ip),
            city: textOrEmpty(payload.city),
            region: textOrEmpty(payload.region),
            country: textOrEmpty(payload.country),
            countryCode: textOrEmpty(payload.country_code),
            latitude: numberOrNull(payload.latitude),
            longitude: numberOrNull(payload.longitude),
            timezone: textOrEmpty(timezone),
            organization: textOrEmpty(connection.org || connection.isp),
            isp: textOrEmpty(connection.isp || connection.org),
            asn: normalizeAsn(connection.asn),
            domain: textOrEmpty(connection.domain)
        };
    };

    const normalizeIpapiIs = (payload) => {
        assertIpResponse(payload, 'ipapi.is');

        return {
            ip: textOrEmpty(payload.ip),
            city: textOrEmpty(payload.city),
            region: textOrEmpty(payload.region),
            country: textOrEmpty(payload.country),
            countryCode: textOrEmpty(payload.country_code),
            latitude: numberOrNull(payload.lat),
            longitude: numberOrNull(payload.lon),
            timezone: textOrEmpty(payload.timezone),
            organization: textOrEmpty(payload.company),
            isp: textOrEmpty(payload.company),
            asn: normalizeAsn(payload.asn),
            domain: '',
            isBogon: typeof payload.is_bogon === 'boolean' ? payload.is_bogon : null,
            riskDataAvailable: [
                'is_datacenter',
                'is_vpn',
                'is_proxy',
                'is_tor',
                'is_abuser'
            ].some((key) => Object.prototype.hasOwnProperty.call(payload, key))
        };
    };

    const normalizeFreeIpApi = (payload) => {
        if (!payload || typeof payload !== 'object' || !textOrEmpty(payload.ipAddress)) {
            throw new Error('freeipapi.com returned no IP data');
        }

        return {
            ip: textOrEmpty(payload.ipAddress),
            city: textOrEmpty(payload.cityName),
            region: textOrEmpty(payload.regionName),
            country: textOrEmpty(payload.countryName),
            countryCode: textOrEmpty(payload.countryCode),
            latitude: numberOrNull(payload.latitude),
            longitude: numberOrNull(payload.longitude),
            timezone: Array.isArray(payload.timeZones) ? textOrEmpty(payload.timeZones[0]) : '',
            organization: textOrEmpty(payload.asnOrganization),
            isp: textOrEmpty(payload.asnOrganization),
            asn: normalizeAsn(payload.asn),
            domain: '',
            isProxy: typeof payload.isProxy === 'boolean' ? payload.isProxy : null
        };
    };

    const request = async (url, parser, fetchImpl = global.fetch) => {
        if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available');

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = controller && typeof setTimeout === 'function'
            ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
            : null;

        try {
            const options = { referrerPolicy: 'no-referrer' };
            if (controller) options.signal = controller.signal;
            const response = await fetchImpl(url, options);
            if (!response || !response.ok) {
                throw new Error(`HTTP ${response?.status ?? 'unknown'} from ${url}`);
            }
            return parser(response);
        } finally {
            if (timeout !== null && typeof clearTimeout === 'function') clearTimeout(timeout);
        }
    };

    const requestJson = (url, fetchImpl = global.fetch) => request(url, (response) => response.json(), fetchImpl);
    const requestText = (url, fetchImpl = global.fetch) => request(url, (response) => response.text(), fetchImpl);

    const getGeoData = async (ip, fetchImpl = global.fetch) => {
        const providers = [
            ['ipwho.is', API_ENDPOINTS.geo.ipwho(ip), normalizeIpWhoIs],
            ['ipapi.is', API_ENDPOINTS.geo.ipapi(ip), normalizeIpapiIs],
            ['freeipapi.com', API_ENDPOINTS.geo.freeIpApi(ip), normalizeFreeIpApi]
        ];
        let lastError = null;

        for (const [, url, normalize] of providers) {
            try {
                return await requestJson(url, fetchImpl).then(normalize);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('All geolocation providers failed');
    };

    const parseTrace = (text) => {
        const result = {};
        String(text).split(/\r?\n/).forEach((line) => {
            const separator = line.indexOf('=');
            if (separator <= 0) return;
            result[line.slice(0, separator)] = line.slice(separator + 1).trim();
        });
        return result;
    };

    const getTraceData = async (fetchImpl = global.fetch) => {
        const trace = parseTrace(await requestText(API_ENDPOINTS.trace, fetchImpl));
        return {
            ip: textOrEmpty(trace.ip),
            colo: textOrEmpty(trace.colo),
            http: textOrEmpty(trace.http),
            tls: textOrEmpty(trace.tls),
            visit_scheme: textOrEmpty(trace.visit_scheme)
        };
    };

    const parseIpify = (payload, provider = 'ipify') => {
        if (!payload || typeof payload !== 'object' || !textOrEmpty(payload.ip)) {
            throw new Error(`${provider} returned no IP data`);
        }
        return textOrEmpty(payload.ip);
    };

    const getDomesticIp = async (fetchImpl = global.fetch) => {
        const payload = await requestJson(API_ENDPOINTS.domesticIp, fetchImpl);
        const ip = payload?.data?.ip || payload?.ip;
        if (!textOrEmpty(ip)) throw new Error('ipip.net returned no IP data');
        return textOrEmpty(ip);
    };

    const getForeignIp = async (fetchImpl = global.fetch) => {
        let lastError = null;
        for (const url of API_ENDPOINTS.foreignIp) {
            try {
                return await requestJson(url, fetchImpl).then((payload) => parseIpify(payload, 'ipify'));
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('All foreign IP providers failed');
    };

    const getIpVersion = async (version, fetchImpl = global.fetch) => {
        const url = API_ENDPOINTS.dualStack[version];
        if (!url) throw new Error(`Unsupported IP version: ${version}`);
        return requestJson(url, fetchImpl).then((payload) => parseIpify(payload, `ipify ${version}`));
    };

    const parseBlackboxDecision = (value) => {
        const result = textOrEmpty(value).split(',')[0].toUpperCase();
        if (result === 'N') {
            return { decision: 'allow', score: null, detectionAvailable: true };
        }
        if (result === 'Y') {
            return { decision: 'block', score: null, detectionAvailable: true };
        }
        return { decision: 'unknown', score: null, detectionAvailable: false };
    };

    const getRiskData = async (ip, fetchImpl = global.fetch) => ({
        provider: 'blackbox.ipinfo.app',
        ...parseBlackboxDecision(await requestText(API_ENDPOINTS.reputation(ip), fetchImpl))
    });

    const getProfile = async (ip, fetchImpl = global.fetch) => {
        const [geoResult, riskResult] = await Promise.allSettled([
            getGeoData(ip, fetchImpl),
            getRiskData(ip, fetchImpl)
        ]);

        if (geoResult.status === 'rejected' && riskResult.status === 'rejected') {
            throw geoResult.reason || riskResult.reason || new Error('IP profile lookup failed');
        }

        return {
            geo: geoResult.status === 'fulfilled' ? geoResult.value : null,
            risk: riskResult.status === 'fulfilled' ? riskResult.value : null
        };
    };

    global.IPCheckAPI = Object.freeze({
        endpoints: API_ENDPOINTS,
        requestJson,
        requestText,
        normalizeIpWhoIs,
        normalizeIpapiIs,
        normalizeFreeIpApi,
        parseTrace,
        parseBlackboxDecision,
        getGeoData,
        getTraceData,
        getDomesticIp,
        getForeignIp,
        getIpVersion,
        getRiskData,
        getProfile
    });
})(typeof window !== 'undefined' ? window : globalThis);

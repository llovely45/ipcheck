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
        reputation: (ip) => `https://blackbox.ipinfo.app/api/v1/${encodeURIComponent(ip)}`,
        reputationSources: Object.freeze({
            blackbox: (ip) => `https://blackbox.ipinfo.app/api/v1/${encodeURIComponent(ip)}`,
            ipinfo: (ip) => `https://ipinfo.io/widget/demo/${encodeURIComponent(ip)}`,
            freeIpApi: (ip) => `https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`
        })
    });

    const textOrEmpty = (value) => value === undefined || value === null ? '' : String(value).trim();

    const numberOrNull = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };

    const expandIpv6 = (value) => {
        const withoutZone = textOrEmpty(value).split('%')[0];
        if (!withoutZone || !withoutZone.includes(':')) return null;

        let groups = withoutZone.includes('::')
            ? (() => {
                const parts = withoutZone.split('::');
                if (parts.length !== 2) return null;
                const left = parts[0] ? parts[0].split(':') : [];
                const right = parts[1] ? parts[1].split(':') : [];
                return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
            })()
            : withoutZone.split(':');

        if (!groups || groups.length !== 8) {
            const last = groups?.[groups.length - 1];
            if (!last || !last.includes('.')) return null;
            const octets = last.split('.').map(Number);
            if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
                return null;
            }
            const mappedGroups = [
                ((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0'),
                ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0')
            ];
            groups = [...groups.slice(0, -1), ...mappedGroups];
        }

        return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group)) ? groups : null;
    };

    const maskIp = (value) => {
        const text = textOrEmpty(value);
        const mappedIpv4 = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
        if (mappedIpv4) {
            const octets = mappedIpv4.slice(2).map(Number);
            if (octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
                return `${mappedIpv4[1]}${octets[0]}.${octets[1]}.*.*`;
            }
        }

        const ipv4Parts = text.split('.');
        if (ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
            return `${ipv4Parts[0]}.${ipv4Parts[1]}.*.*`;
        }

        const ipv6Groups = expandIpv6(text);
        return ipv6Groups ? `${ipv6Groups.slice(0, 6).join(':')}:*:*` : text;
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

    const parseBlackboxRisk = (value) => {
        const result = parseBlackboxDecision(value);
        return {
            status: result.detectionAvailable ? 'available' : 'unavailable',
            decision: result.decision,
            score: result.detectionAvailable ? (result.decision === 'block' ? 15 : 90) : null,
            flags: result.decision === 'block' ? ['建议拦截'] : []
        };
    };

    const parseIpinfoPrivacyResponse = (payload) => {
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (!data || typeof data !== 'object' || !textOrEmpty(data.ip)) {
            throw new Error('ipinfo.io returned no IP data');
        }

        const privacy = data.privacy && typeof data.privacy === 'object' ? data.privacy : {};
        const signals = {
            vpn: privacy.vpn === true,
            proxy: privacy.proxy === true,
            tor: privacy.tor === true,
            relay: privacy.relay === true,
            hosting: privacy.hosting === true || data.is_hosting === true,
            anonymous: data.is_anonymous === true
        };
        const hasPrivacyData = Object.keys(signals).some((key) =>
            typeof privacy[key] === 'boolean' || (key === 'hosting' && typeof data.is_hosting === 'boolean') || (key === 'anonymous' && typeof data.is_anonymous === 'boolean')
        );
        if (!hasPrivacyData) throw new Error('ipinfo.io returned no privacy data');

        const flags = [];
        if (signals.vpn) flags.push('VPN');
        if (signals.proxy) flags.push('Proxy');
        if (signals.tor) flags.push('Tor');
        if (signals.relay) flags.push('Relay');
        if (signals.anonymous) flags.push('匿名');
        if (signals.hosting) flags.push('托管/数据中心');

        const penalties = {
            vpn: 45,
            proxy: 40,
            tor: 50,
            relay: 25,
            hosting: 25,
            anonymous: 30
        };
        const score = Math.max(1, Math.min(100, 95 - Object.keys(penalties).reduce(
            (total, key) => total + (signals[key] ? penalties[key] : 0),
            0
        )));
        const severeRisk = signals.vpn || signals.proxy || signals.tor || signals.relay || signals.anonymous;

        return {
            ip: textOrEmpty(data.ip),
            status: 'available',
            decision: severeRisk ? 'block' : 'allow',
            score,
            flags,
            signals
        };
    };

    const parseFreeIpApiRisk = (payload) => {
        if (!payload || typeof payload !== 'object' || !textOrEmpty(payload.ipAddress)) {
            throw new Error('freeipapi.com returned no IP data');
        }
        if (typeof payload.isProxy !== 'boolean') {
            throw new Error('freeipapi.com returned no proxy data');
        }

        return {
            ip: textOrEmpty(payload.ipAddress),
            status: 'available',
            decision: payload.isProxy ? 'block' : 'allow',
            score: payload.isProxy ? 15 : 90,
            flags: payload.isProxy ? ['Proxy'] : [],
            signals: { proxy: payload.isProxy }
        };
    };

    const RISK_SOURCE_DEFINITIONS = Object.freeze([
        Object.freeze({
            id: 'blackbox',
            provider: 'blackbox.ipinfo.app',
            weight: 0.35,
            description: '公开二值风控判定',
            request: (ip, fetchImpl) => requestText(API_ENDPOINTS.reputationSources.blackbox(ip), fetchImpl),
            parse: parseBlackboxRisk
        }),
        Object.freeze({
            id: 'ipinfo',
            provider: 'ipinfo.io（demo）',
            weight: 0.45,
            description: '隐私、匿名与托管信号',
            request: (ip, fetchImpl) => requestJson(API_ENDPOINTS.reputationSources.ipinfo(ip), fetchImpl),
            parse: parseIpinfoPrivacyResponse
        }),
        Object.freeze({
            id: 'freeipapi',
            provider: 'freeipapi.com',
            weight: 0.20,
            description: '公开 Proxy 标记',
            request: (ip, fetchImpl) => requestJson(API_ENDPOINTS.reputationSources.freeIpApi(ip), fetchImpl),
            parse: parseFreeIpApiRisk
        })
    ]);

    const aggregatePurityScores = (sources) => {
        const items = Array.isArray(sources) ? sources : [];
        const totalWeight = items.reduce((total, source) => {
            const weight = Number(source?.weight);
            return Number.isFinite(weight) && weight > 0 ? total + weight : total;
        }, 0);
        const scoredSources = items.filter((source) => {
            const score = Number(source?.score);
            const weight = Number(source?.weight);
            return Number.isFinite(score) && score >= 1 && score <= 100 && Number.isFinite(weight) && weight > 0;
        });
        const scoredWeight = scoredSources.reduce((total, source) => total + Number(source.weight), 0);
        const score = scoredWeight > 0
            ? Math.round(scoredSources.reduce((total, source) => total + Number(source.score) * Number(source.weight), 0) / scoredWeight)
            : null;
        const classification = score === null
            ? 'unknown'
            : score >= 85 ? 'excellent'
                : score >= 70 ? 'good'
                    : score >= 50 ? 'caution'
                        : 'poor';
        const decision = score === null ? 'unknown' : score < 40 ? 'block' : score < 70 ? 'review' : 'allow';

        return {
            score,
            sourceCount: scoredSources.length,
            totalSourceCount: items.length,
            coverage: totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0,
            classification,
            decision,
            sources: items,
            basis: '启发式静态权重：参考供应商规模/行业信誉、数据维度与公开可用性；不是官方评级。'
        };
    };

    const getRiskData = async (ip, fetchImpl = global.fetch) => {
        const sources = await Promise.all(RISK_SOURCE_DEFINITIONS.map(async (definition) => {
            const base = {
                id: definition.id,
                provider: definition.provider,
                weight: definition.weight,
                description: definition.description,
                status: 'unavailable',
                decision: 'unknown',
                score: null,
                flags: []
            };
            try {
                return { ...base, ...definition.parse(await definition.request(ip, fetchImpl)) };
            } catch (error) {
                return base;
            }
        }));

        return {
            provider: '多源 IP 纯净度',
            ...aggregatePurityScores(sources)
        };
    };

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
        maskIp,
        normalizeIpWhoIs,
        normalizeIpapiIs,
        normalizeFreeIpApi,
        parseTrace,
        parseBlackboxDecision,
        parseBlackboxRisk,
        parseIpinfoPrivacyResponse,
        parseFreeIpApiRisk,
        aggregatePurityScores,
        getGeoData,
        getTraceData,
        getDomesticIp,
        getForeignIp,
        getIpVersion,
        getRiskData,
        getProfile,
        riskSources: RISK_SOURCE_DEFINITIONS
    });
})(typeof window !== 'undefined' ? window : globalThis);

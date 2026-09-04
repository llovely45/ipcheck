const { useState, useEffect, useRef } = React;
const { createRoot } = ReactDOM;
const {
    getGeoData,
    getTraceData,
    getDomesticIp,
    getForeignIp,
    getIpVersion,
    getProfile,
    maskIp
} = window.IPCheckAPI;

// --- Helper Functions ---
const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` : null;
};

const useIpReveal = () => {
    const [revealed, setRevealed] = useState(false);

    return {
        revealed,
        revealHandlers: {
            onMouseEnter: () => setRevealed(true),
            onMouseLeave: () => setRevealed(false),
            onFocus: () => setRevealed(true),
            onBlur: (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setRevealed(false);
            }
        }
    };
};

const MaskedIp = ({ ip, revealed }) => {
    const text = revealed ? ip : maskIp(ip);
    const isMasked = Boolean(ip && text !== ip);

    return (
        <span
            className="inline-flex items-center gap-2"
            title={isMasked ? '悬停或聚焦卡片显示完整 IP' : undefined}
            aria-label={isMasked ? 'IP 已脱敏，悬停或聚焦卡片显示完整 IP' : text}
        >
            <span>{text}</span>
            {isMasked && <span className="text-[10px] font-sans font-medium text-gray-400 dark:text-slate-500">悬停查看</span>}
        </span>
    );
};

// --- Helper Hook for Data Fetching ---
const useIpData = () => {
    const [data, setData] = useState({
        ip: 'Loading...',
        colo: '...',
        http: '...',
        tls: '...',
        loc: 'Loading...',
        isp: '...',
        asn: '...',
        visit_scheme: '...'
    });

    useEffect(() => {
        let active = true;

        getGeoData()
            .then(geo => {
                if (!active) return;
                const location = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
                setData(prev => ({
                    ...prev,
                    ip: geo.ip || 'Error',
                    loc: location || 'Unknown',
                    isp: geo.isp || geo.organization || 'Unknown',
                    country: geo.country || 'Unknown',
                    asn: geo.asn || 'N/A'
                }));
            })
            .catch(err => {
                console.error('IP geolocation failed', err);
                if (active) setData(prev => ({ ...prev, ip: 'Error' }));
            });

        getTraceData()
            .then(trace => {
                if (!active) return;
                setData(prev => ({
                    ...prev,
                    http: trace.http || (window.location.protocol === 'https:' ? 'HTTP/2' : 'HTTP/1.1'),
                    tls: trace.tls || (window.location.protocol === 'https:' ? 'TLS 1.2+' : 'None'),
                    visit_scheme: trace.visit_scheme || (window.location.protocol === 'https:' ? 'https' : 'http'),
                    colo: trace.colo || prev.colo
                }));
            })
            .catch(err => {
                console.log('Cloudflare Trace unavailable; using local defaults');
                if (active) {
                    setData(prev => ({
                        ...prev,
                        http: window.location.protocol === 'https:' ? 'HTTP/2' : 'HTTP/1.1',
                        tls: window.location.protocol === 'https:' ? 'TLS 1.2+' : 'None'
                    }));
                }
            });

        return () => { active = false; };
    }, []);

    return data;
};

const Sparkline = ({ data, color, width = 100, height = 30 }) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 100);
    const min = Math.min(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    const strokeColor = color === 'green' ? '#10b981' : (color === 'yellow' ? '#f59e0b' : '#f43f5e');

    return (
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
            <defs>
                <linearGradient id={`grad-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`M0,${height} ${points} ${width},${height} Z`} fill={`url(#grad-${color})`} />
            <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="2" fill={strokeColor} className="animate-pulse" />
        </svg>
    );
};

const PingCard = ({ name, url, icon, index }) => {
    const [ms, setMs] = useState(null);
    const [history, setHistory] = useState(new Array(10).fill(0));

    useEffect(() => {
        const ping = () => {
            const start = Date.now();
            const img = new Image();
            const update = () => {
                const t = Date.now() - start;
                setMs(t);
                setHistory(prev => [...prev.slice(1), t]);
            };
            img.onload = update;
            img.onerror = update;
            img.src = `${url}?t=${Date.now()}`;
        };
        const t1 = setTimeout(ping, index * 200);
        const t2 = setInterval(ping, 2000);
        return () => { clearTimeout(t1); clearInterval(t2); };
    }, [url]);

    const statusColor = !ms ? 'gray' : (ms < 100 ? 'green' : (ms < 300 ? 'yellow' : 'red'));
    const colorName = statusColor === 'green' ? 'emerald' : statusColor === 'yellow' ? 'amber' : (statusColor === 'red' ? 'rose' : 'gray');

    return (
        <div
            className="glass-card p-3 rounded-xl flex items-center justify-between gap-3 group hover:-translate-y-1 transition-transform duration-300 relative overflow-hidden"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            <div className="flex items-center gap-3 z-10">
                <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-slate-800/80 border border-white dark:border-slate-700 flex items-center justify-center shadow-sm transition-colors">
                    <img src={icon} className="w-5 h-5 object-contain" />
                </div>
                <div>
                    <div className="text-[11px] font-bold text-gray-700 dark:text-slate-200 leading-tight transition-colors">{name}</div>
                    <div className={`text-[10px] font-mono font-bold ${statusColor === 'green' ? 'text-emerald-600 dark:text-emerald-400' :
                            statusColor === 'yellow' ? 'text-amber-600 dark:text-amber-400' :
                                statusColor === 'red' ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-gray-500'
                        }`}>
                        {ms ? `${ms}ms` : 'Waiting...'}
                    </div>
                </div>
            </div>
            <div className="w-16 h-8 opacity-60 group-hover:opacity-100 transition-opacity z-10">
                <Sparkline data={history} color={statusColor} />
            </div>
            <div className={`absolute right-0 top-0 w-28 h-full bg-gradient-to-l from-${colorName}-50/50 dark:from-${colorName}-500/10 to-transparent pointer-events-none`} />
        </div>
    );
};

const RiskReport = ({ data, loading }) => {
    if (loading) return (
        <div className="mt-4 p-4 border border-dashed border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50/50 dark:bg-slate-800/50 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/4 mb-4"></div>
            <div className="space-y-2">
                <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
                <div className="h-2 bg-gray-200 dark:bg-slate-700 rounded w-5/6"></div>
            </div>
        </div>
    );

    if (!data) return null;

    const geo = data.geo || {};
    const risk = data.risk || {};
    const decision = risk.decision || 'unknown';
    const decisionMeta = {
        allow: { label: '未发现高风险', type: 'good', color: 'text-emerald-500' },
        review: { label: '建议人工复核', type: 'warn', color: 'text-amber-500' },
        block: { label: '存在高风险信号', type: 'bad', color: 'text-rose-500' },
        unknown: { label: '数据不足', type: 'neutral', color: 'text-gray-500 dark:text-slate-400' }
    }[decision] || { label: '数据不足', type: 'neutral', color: 'text-gray-500 dark:text-slate-400' };
    const classificationMeta = {
        excellent: { label: '优秀', color: 'text-emerald-500' },
        good: { label: '良好', color: 'text-green-500' },
        caution: { label: '需注意', color: 'text-amber-500' },
        poor: { label: '较差', color: 'text-rose-500' },
        unknown: { label: '不可用', color: 'text-gray-500 dark:text-slate-400' }
    }[risk.classification] || { label: '不可用', color: 'text-gray-500 dark:text-slate-400' };
    const sources = Array.isArray(risk.sources) ? risk.sources : [];
    const score = Number.isFinite(risk.score) ? risk.score : null;
    const riskPointLabels = new Set();
    sources.forEach((source) => {
        if (!Array.isArray(source?.flags)) return;
        source.flags.forEach((flag) => {
            const label = String(flag || '').trim();
            if (label) riskPointLabels.add(label);
        });
    });
    if (geo.isProxy === true) riskPointLabels.add('Proxy');
    if (geo.isBogon === true) riskPointLabels.add('Bogon');
    const riskPointCount = riskPointLabels.size;
    const hasRiskData = sources.some((source) => source?.status === 'available')
        || typeof geo.isProxy === 'boolean'
        || typeof geo.isBogon === 'boolean';
    const hasCoordinates = Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude);
    const country = [geo.country, geo.countryCode ? `(${geo.countryCode})` : ''].filter(Boolean).join(' ');
    const cityRegion = [geo.city, geo.region].filter(Boolean).join(', ');

    const InfoRow = ({ label, value, sub }) => (
        <div className="flex flex-col py-1.5 border-b border-gray-100/50 dark:border-slate-700/50 last:border-0">
            <span className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold tracking-wider">{label}</span>
            <span className="text-xs font-medium text-gray-700 dark:text-slate-300 break-all">{value || 'N/A'}</span>
            {sub && <span className="text-[10px] text-gray-400 dark:text-slate-500">{sub}</span>}
        </div>
    );

    const Tag = ({ type, active, text }) => {
        if (!active) return null;
        const colors = {
            bad: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900',
            good: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900',
            warn: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900',
            neutral: 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-100 dark:border-slate-700'
        };
        return (
            <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${colors[type]}`}>
                {text}
            </span>
        );
    };

    const getLocalTime = (tz) => {
        if (!tz) return '未知';
        try {
            return new Date().toLocaleTimeString('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
        } catch { return '未知'; }
    };

    return (
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-700 transition-colors">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                <div className="bg-white/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-lg p-3 text-center relative overflow-hidden group transition-colors">
                    <div className="relative z-10">
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold">综合判定</div>
                        <div className={`text-base font-bold mt-1 ${decisionMeta.color}`}>{decisionMeta.label}</div>
                    </div>
                    <div className={`absolute bottom-0 left-0 h-1 bg-current w-full opacity-20 ${decisionMeta.color}`}></div>
                </div>
                <div className="bg-white/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-lg p-3 text-center relative overflow-hidden group transition-colors">
                    <div className="relative z-10">
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold">纯净度评分</div>
                        <div className={`text-xl font-mono font-bold mt-1 ${classificationMeta.color}`}>
                            {score === null ? 'N/A' : `${score}/100`}
                        </div>
                        <div className={`text-[10px] font-semibold ${classificationMeta.color}`}>{classificationMeta.label}</div>
                    </div>
                    <div className={`absolute bottom-0 left-0 h-1 bg-current w-full opacity-20 ${classificationMeta.color}`}></div>
                </div>
                <div className="col-span-2 md:col-span-1 bg-white/50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700 rounded-lg p-3 text-center relative overflow-hidden group transition-colors">
                    <div className="relative z-10">
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold">风控点</div>
                        <div className={`text-xl font-mono font-bold mt-1 ${riskPointCount > 0 ? 'text-rose-500' : hasRiskData ? 'text-emerald-500' : 'text-gray-700 dark:text-slate-200'}`}>
                            {hasRiskData ? riskPointCount : 'N/A'}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-slate-500">
                            {hasRiskData ? (riskPointCount === 0 ? '未识别已知风险' : '已识别风险信号') : '数据不可用'}
                        </div>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 bg-current w-full opacity-20 text-gray-400"></div>
                </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
                <Tag type={decisionMeta.type} active={decision !== 'unknown'} text={decisionMeta.label} />
                <Tag type="bad" active={geo.isProxy === true} text="Proxy" />
                <Tag type="bad" active={geo.isBogon === true} text="Bogon" />
                <Tag type="neutral" active={decision === 'unknown'} text="来源不足" />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <InfoRow label="ASN" value={geo.asn} sub={geo.organization} />
                <InfoRow label="运营商" value={geo.isp || geo.organization} sub={geo.domain} />
                <InfoRow label="国家/地区" value={country} />
                <InfoRow label="数据来源" value={risk.provider || 'Geo API'} />
                <div className="col-span-2 mt-2 pt-2 border-t border-dashed border-gray-200 dark:border-slate-700 transition-colors">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold">地理位置详情</span>
                        {hasCoordinates && (
                            <a href={`https://www.google.com/maps/search/?api=1&query=${geo.latitude},${geo.longitude}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline">Open Map ↗</a>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-slate-400">
                        <div>
                            <span className="block text-[10px] text-gray-400 dark:text-slate-500">城市/地区</span>
                            {cityRegion || 'N/A'}
                        </div>
                        <div>
                            <span className="block text-[10px] text-gray-400 dark:text-slate-500">时区 & 时间</span>
                            {geo.timezone ? `${geo.timezone} (${getLocalTime(geo.timezone)})` : 'N/A'}
                        </div>
                    </div>
                </div>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-3">
                纯净度分值范围为 1–100，1 最差、100 最好；来源只返回有限风险信号，不代表绝对安全。
            </p>
        </div>
    );
};

const IpCard = ({ title, type, delay = 0, accent, cfIp }) => {
    const [info, setInfo] = useState({ ip: 'Initializing...', status: 'loading' });
    const [profile, setProfile] = useState(null);
    const [loadProfile, setLoadProfile] = useState(false);
    const { revealed, revealHandlers } = useIpReveal();

    useEffect(() => {
        let active = true;

        const init = async () => {
            await new Promise(r => setTimeout(r, delay));
            let ip = null;

            try {
                if (type === 'domestic') {
                    ip = await getDomesticIp();
                } else if (type === 'foreign') {
                    ip = await getForeignIp();
                } else if (type === 'cloudflare') {
                    ip = cfIp;
                }

                if (!ip || ip === 'Loading...' || ip === 'Error') throw new Error('No IP returned');
                if (!active) return;

                setInfo({ ip: ip, status: 'ok' });

                setLoadProfile(true);
                try {
                    const nextProfile = await getProfile(ip);
                    if (active) setProfile(nextProfile);
                } catch (error) {
                    console.warn(`IP profile lookup failed for ${type}`, error);
                    if (active) setProfile({ geo: null, risk: null });
                } finally {
                    if (active) setLoadProfile(false);
                }
            } catch (error) {
                if (active) {
                    setInfo({ ip: 'Connection Failed', status: 'error' });
                    setLoadProfile(false);
                }
            }
        };

        // If it's cloudflare type, we only run when cfIp is ready/changed
        if (type === 'cloudflare') {
            if (cfIp && cfIp !== 'Loading...' && cfIp !== 'Error') {
                init();
            } else if (cfIp === 'Error') {
                setInfo({ ip: 'Connection Failed', status: 'error' });
            }
        } else {
            init();
        }

        return () => { active = false; };
    }, [type, cfIp, delay]);

    const isErr = info.status === 'error';
    const isLoading = info.status === 'loading' || (type === 'cloudflare' && (!cfIp || cfIp === 'Loading...'));

    return (
        <div
            className="glass-card rounded-2xl p-6 relative overflow-hidden animate-slide-up h-full flex flex-col"
            style={{ animationDelay: `${delay}ms` }}
            tabIndex="0"
            {...revealHandlers}
        >
            <div className={`absolute top-0 left-0 w-full h-1 bg-${accent}-500`}></div>
            <div className="scan-line"></div>

            <div className="flex justify-between items-start mb-3 relative z-10">
                <h3 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-${accent}-600 dark:text-${accent}-400`}>
                    <span className={`w-2 h-2 rounded-full bg-${accent}-500 shadow-neon`}></span>
                    {title}
                </h3>
                {isLoading && <div className="w-3 h-3 border-2 border-gray-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin"></div>}
            </div>

            <div className="mb-2 relative z-10">
                {isLoading ? (
                    <div className="h-8 w-3/4 bg-gray-100 dark:bg-slate-700 rounded animate-pulse"></div>
                ) : (
                    <div className={`text-2xl font-mono font-bold tracking-tight break-all ${isErr ? 'text-rose-500' : 'text-gray-800 dark:text-slate-100'}`}>
                        <MaskedIp ip={info.ip} revealed={revealed} />
                    </div>
                )}
            </div>

            {!isErr && !isLoading && (
                <div className="flex-1 relative z-10">
                    <RiskReport data={profile} loading={loadProfile} />
                </div>
            )}
        </div>
    );
};

const SettingsMenu = ({ theme, setTheme, bgName, setBgName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const backgrounds = [
        { name: 'Default', label: '默认', val: '#f0f4f8', type: 'light' },
        { name: 'EyeGreen', label: '护眼绿', val: '#C7EDCC', type: 'light' },
        { name: 'Warm', label: '暖色', val: '#FAF9DE', type: 'light' },
        { name: 'Cool', label: '冷色', val: '#d6e4ff', type: 'light' },
    ];

    return (
        <div className="relative z-50" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="glass-card p-2 rounded-full text-gray-600 dark:text-slate-300 hover:text-primary dark:hover:text-primary transition-colors focus:outline-none"
                aria-label="Settings"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>

            {isOpen && (
                <div className="settings-menu glass-card bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 shadow-xl">
                    <div className="mb-4">
                        <h4 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Theme Mode</h4>
                        <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                            {['light', 'auto', 'dark'].map((m) => (
                                <button
                                    key={m}
                                    onClick={() => setTheme(m)}
                                    className={`flex-1 capitalize text-xs font-semibold py-1.5 rounded-md transition-all ${theme === m
                                            ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
                                            : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                                        }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Background Theme</h4>
                        <div className="flex flex-wrap gap-2">
                            {backgrounds.map((bg) => (
                                <button
                                    key={bg.name}
                                    onClick={() => setBgName(bg.name)}
                                    className={`color-swatch ${bgName === bg.name ? 'active' : ''}`}
                                    style={{ backgroundColor: bg.val }}
                                    title={bg.label}
                                >
                                    {bgName === bg.name && (
                                        <svg className="w-4 h-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2">
                            * Effects visible in Light Mode
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};


const NetworkHeader = ({ cfData, theme, setTheme, bgName, setBgName }) => {
    const [conn, setConn] = useState(null);
    useEffect(() => {
        if (navigator.connection) {
            setConn({
                type: navigator.connection.effectiveType,
                rtt: navigator.connection.rtt,
                saveData: navigator.connection.saveData
            });
        }
    }, []);

    return (
        <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-slide-up relative z-50">
            <div className="flex items-center gap-4">
                <div className="relative">
                    <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl shadow-glass flex items-center justify-center text-primary relative z-10 transition-colors">
                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    </div>
                    <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-tight transition-colors">ipcheck</h1>
                    <p className="text-xs text-gray-500 dark:text-slate-400 font-mono flex items-center gap-2 transition-colors">
                        <span>{cfData.colo} • {cfData.loc}</span>
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <div className="glass-card px-4 py-2 rounded-full flex items-center gap-4 text-xs font-mono text-gray-600 dark:text-slate-300 shadow-sm transition-colors">
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-glow"></span>
                        <span>Protocol: {cfData.http}</span>
                    </div>
                    <div className="w-px h-3 bg-gray-300 dark:bg-slate-600"></div>
                    <div>TLS: {cfData.tls}</div>
                    {conn && conn.type && (
                        <>
                            <div className="w-px h-3 bg-gray-300 dark:bg-slate-600"></div>
                            <div>Net: {conn.type.toUpperCase()} (~{conn.rtt}ms)</div>
                        </>
                    )}
                </div>

                <SettingsMenu theme={theme} setTheme={setTheme} bgName={bgName} setBgName={setBgName} />
            </div>
        </header>
    );
};

const Fingerprint = () => {
    const [fp, setFp] = useState(null);
    useEffect(() => {
        const getCanvas = () => {
            try {
                const c = document.createElement('canvas');
                const ctx = c.getContext('2d');
                ctx.fillText("Cloudflare", 2, 2);
                return c.toDataURL().slice(-10);
            } catch { return 'Err'; }
        };
        setFp({
            ua: navigator.userAgent,
            lang: navigator.language,
            platform: navigator.platform,
            cores: navigator.hardwareConcurrency || 'Unknown',
            memory: navigator.deviceMemory ? `~${navigator.deviceMemory}GB` : 'Unknown',
            cookies: navigator.cookieEnabled ? 'Enabled' : 'Disabled',
            screen: `${window.screen.width}x${window.screen.height} (${window.screen.colorDepth}-bit)`,
            gpu: (function () {
                try {
                    const c = document.createElement('canvas');
                    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    return debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown';
                } catch { return 'Unknown'; }
            })(),
            canvasHash: getCanvas()
        });
    }, []);

    if (!fp) return null;

    const Item = ({ label, val, icon }) => (
        <div className="bg-gray-50/50 dark:bg-slate-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-700 transition-colors">
            <div className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">
                {icon && <span>{icon}</span>}
                {label}
            </div>
            <div className="text-xs font-mono text-gray-700 dark:text-slate-300 break-words font-medium">{val}</div>
        </div>
    );

    return (
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden animate-slide-up" style={{ animationDelay: '600ms' }}>
            <h3 className="text-sm font-bold text-gray-600 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.131A8 8 0 008 2.855" /></svg>
                指纹检测
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2 md:col-span-4"><Item label="User Agent" val={fp.ua} /></div>
                <Item label="GPU 渲染器" val={fp.gpu} />
                <Item label="系统平台" val={fp.platform} />
                <Item label="CPU 核心" val={fp.cores} />
                <Item label="设备内存" val={fp.memory} />
                <Item label="屏幕参数" val={fp.screen} />
                <Item label="系统语言" val={fp.lang} />
                <Item label="Cookies" val={fp.cookies} />
                <Item label="Canvas Hash" val={fp.canvasHash} />
            </div>
        </div>
    );
};

const DualStackCard = ({ type, color }) => {
    const [ip, setIp] = useState(null);
    const { revealed, revealHandlers } = useIpReveal();
    useEffect(() => {
        let active = true;
        getIpVersion(type)
            .then(value => { if (active) setIp(value); })
            .catch(() => { if (active) setIp('N/A'); });
        return () => { active = false; };
    }, [type]);

    const borderColor = color === 'blue' ? 'border-blue-500 dark:border-blue-700' : 'border-purple-500 dark:border-purple-700';
    const label = type === 'v4' ? 'IPv4 Connectivity' : 'IPv6 Connectivity';

    return (
        <div
            className={`glass-card border-l-[3px] ${borderColor} rounded-xl p-4 flex items-center justify-between relative overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
            tabIndex="0"
            {...revealHandlers}
        >
            <div className="z-10">
                <div className="text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-wider mb-1">{label}</div>
                <div className="font-mono font-bold text-gray-800 dark:text-slate-100 text-sm break-all transition-colors">
                    {ip ? <MaskedIp ip={ip} revealed={revealed} /> : <span className="animate-pulse bg-gray-200 dark:bg-slate-700 text-transparent rounded">Loading IP Address...</span>}
                </div>
            </div>
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 bg-${color}-400/10 dark:bg-${color}-500/20 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500`}></div>
        </div>
    );
};

// Theme Definitions
const THEMES = {
    Default: {
        bgBody: '#f0f4f8',
        bgCard: 'rgba(255, 255, 255, 0.8)',
        bgCardBorder: 'rgba(255, 255, 255, 0.8)',
        primary: '243 128 32' // Orange
    },
    EyeGreen: {
        bgBody: '#C7EDCC',
        bgCard: 'rgba(232, 245, 233, 0.9)',
        bgCardBorder: 'rgba(199, 237, 204, 0.5)',
        primary: '16 185 129' // Emerald
    },
    Warm: {
        bgBody: '#FAF9DE',
        bgCard: 'rgba(255, 253, 231, 0.9)',
        bgCardBorder: 'rgba(255, 249, 196, 0.5)',
        primary: '245 158 11' // Amber
    },
    Cool: {
        bgBody: '#d6e4ff',
        bgCard: 'rgba(235, 246, 255, 0.9)',
        bgCardBorder: 'rgba(191, 219, 254, 0.5)',
        primary: '59 130 246' // Blue
    }
};

const App = () => {
    const cfData = useIpData();
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'auto');
    const [bgName, setBgName] = useState(localStorage.getItem('bgTheme') || 'Default');

    // Theme Mode (Light/Dark)
    useEffect(() => {
        localStorage.setItem('theme', theme);
        const updateTheme = () => {
            const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            if (isDark) {
                document.documentElement.classList.add('dark');
                document.body.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
                document.body.classList.remove('dark');
            }
        };
        updateTheme();

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => { if (theme === 'auto') updateTheme(); };
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, [theme]);

    // Background Theme Logic
    useEffect(() => {
        localStorage.setItem('bgTheme', bgName);
        const config = THEMES[bgName] || THEMES['Default'];

        document.documentElement.style.setProperty('--bg-body', config.bgBody);
        document.documentElement.style.setProperty('--bg-card', config.bgCard);
        document.documentElement.style.setProperty('--bg-card-border', config.bgCardBorder);
        document.documentElement.style.setProperty('--color-primary', config.primary);

    }, [bgName]);

    return (
        <div className="pt-2">
            <NetworkHeader cfData={cfData} theme={theme} setTheme={setTheme} bgName={bgName} setBgName={setBgName} />

            <section className="mb-8 animate-slide-up" style={{ animationDelay: '100ms' }}>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <PingCard index={0} name="Bilibili" url="https://i0.hdslb.com/bfs/face/member/noface.jpg" icon="static/icons/bilibili.ico" />
                    <PingCard index={1} name="WeChat" url="https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico" icon="static/icons/wechat.ico" />
                    <PingCard index={2} name="Google" url="https://www.google.com/favicon.ico" icon="static/icons/google.ico" />
                    <PingCard index={3} name="Cloudflare" url="https://www.cloudflare.com/favicon.ico" icon="static/icons/cloudflare.ico" />
                    <PingCard index={4} name="GitHub" url="https://github.github.io/janky/images/bg_hr.png" icon="static/icons/github.ico" />
                    <PingCard index={5} name="YouTube" url="https://i.ytimg.com/vi/M7lc1UVf-VE/mqdefault.jpg" icon="static/icons/youtube.ico" />
                    <PingCard index={6} name="OpenAI" url="https://openai.com/favicon.ico" icon="static/icons/openai.ico" />
                    <PingCard index={7} name="Telegram" url="https://telegram.org/img/t_logo.png" icon="static/icons/telegram.ico" />
                    <PingCard index={8} name="Netflix" url="https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.ico" icon="static/icons/netflix.ico" />
                    <PingCard index={9} name="Apple" url="https://www.apple.com/favicon.ico" icon="static/icons/apple.ico" />
                </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 animate-slide-up" style={{ animationDelay: '200ms' }}>
                <DualStackCard type="v4" color="blue" />
                <DualStackCard type="v6" color="purple" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <IpCard title="国内出口" type="domestic" delay={300} accent="blue" />
                <IpCard title="国外出口" type="foreign" delay={400} accent="amber" />
                <IpCard title="Cloudflare" type="cloudflare" delay={500} accent="orange" cfIp={cfData.ip} />
            </div>

            <Fingerprint />

            <footer className="text-center text-gray-400 dark:text-slate-600 text-[10px] py-6 font-mono border-t border-gray-200/50 dark:border-slate-800/50 mt-12 transition-colors">
                <p className="flex justify-center items-center gap-2">
                    <span><a href="https://github.com/llovely45/ipcheck" className="hover:text-primary dark:hover:text-primary">ipcheck</a></span>
                    <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-slate-700"></span>
                    <span>Static Version</span>
                </p>
            </footer>
        </div>
    );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);

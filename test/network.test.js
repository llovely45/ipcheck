import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function api() {
    const window = {};
    vm.runInNewContext(readFileSync(new URL('../static/api.js', import.meta.url), 'utf8'),
        { window, URL, AbortController, setTimeout, clearTimeout, console });
    return window.IPCheckAPI;
}
const response = (value) => ({ ok: true, text: async () => value, json: async () => value });

test('domestic probes validate each family and use only domestic fallbacks', async () => {
    const client = api();
    const calls = [];
    const result = await client.getDomesticDualStack(async (url) => {
        calls.push(url);
        if (url.includes('ipv4.ip.mir6')) return response('203.0.113.8');
        if (url.includes('ipv6.ip.mir6')) return response('203.0.113.8'); // Wrong family must be rejected.
        if (url.includes('test6.ustc')) return response({ processedString: '2001:db8::1' });
        throw new Error('Unexpected provider');
    });
    assert.equal(result.v4.ip, '203.0.113.8');
    assert.equal(result.v6.ip, '2001:db8::1');
    assert.equal(result.dualStack, true);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => !url.includes('ipify')));
});

test('failed IPv6 probes do not discard IPv4 or claim IPv6 is unsupported', async () => {
    const result = await api().getDomesticDualStack(async (url) => {
        if (url.includes('ipv4.ip.mir6')) return response('203.0.113.8');
        return response('<html>error</html>');
    });
    assert.equal(result.v4.status, 'available');
    assert.equal(result.v6.status, 'unavailable');
    assert.equal(result.dualStack, false);
    assert.equal(result.v6.ip, null);
});

test('IP family parsing rejects invalid addresses and mDNS names', () => {
    const client = api();
    for (const ip of ['999.1.1.1', 'a.local', '1:2:3', '2001:::1', 'not an IP']) {
        assert.equal(client.getAddressVersion(ip), null);
    }
    assert.equal(client.getAddressVersion('2001:db8::1'), 'v6');
    assert.equal(client.getAddressVersion('203.0.113.1'), 'v4');
});

function peerClass(gather) {
    return class {
        static last;
        constructor(config) { this.config = config; this.constructor.last = this; }
        createDataChannel() { return { close: () => { this.channelClosed = true; } }; }
        async createOffer() { return { type: 'offer', sdp: '' }; }
        async setLocalDescription() { gather?.(this); }
        close() { this.closed = true; }
    };
}
const emit = (pc, address, type = 'srflx') => pc.onicecandidate?.({ candidate: {
    address, type, candidate: `candidate:1 1 udp 1 ${address} 12345 typ ${type}`
} });

test('WebRTC uses Xiaomi STUN, deduplicates public IPs and excludes local addresses', async () => {
    const PeerConnection = peerClass(pc => {
        emit(pc, '192.168.1.2', 'host');
        emit(pc, 'abc.local', 'host');
        emit(pc, '203.0.113.8');
        emit(pc, '203.0.113.8');
        emit(pc, '2001:db8::1', 'host');
        emit(pc, 'fe80::1', 'host');
        emit(pc, 'fd00::1', 'host');
        pc.onicecandidate({ candidate: null });
    });
    const result = await api().getWebRtcIps({ PeerConnection });
    assert.equal(PeerConnection.last.config.iceServers[0].urls, 'stun:stun.miwifi.com:3478');
    assert.deepEqual(Array.from(result.ips), ['203.0.113.8', '2001:db8::1']);
    assert.equal(result.status, 'available');
    assert.equal(PeerConnection.last.closed, true);
    assert.equal(PeerConnection.last.channelClosed, true);
});

test('WebRTC settles and releases resources on timeout, cancellation and setup failure', async () => {
    const client = api();
    const PeerConnection = peerClass();
    const timed = await client.getWebRtcIps({ PeerConnection, timeoutMs: 5 });
    assert.equal(timed.status, 'timeout');
    assert.equal(PeerConnection.last.closed, true);
    const controller = new AbortController();
    const promise = client.getWebRtcIps({ PeerConnection, signal: controller.signal });
    controller.abort();
    assert.equal((await promise).status, 'aborted');
    assert.equal(PeerConnection.last.closed, true);
    const Broken = peerClass();
    Broken.prototype.createOffer = async () => { throw new Error('blocked'); };
    assert.equal((await client.getWebRtcIps({ PeerConnection: Broken })).status, 'error');
    assert.equal(Broken.last.closed, true);
    assert.equal((await client.getWebRtcIps({ PeerConnection: null })).status, 'unsupported');
});

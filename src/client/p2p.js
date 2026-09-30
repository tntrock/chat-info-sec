// 大檔案走 WebRTC 點對點（DTLS 加密），信令本身也經房間金鑰加密後才透過伺服器轉送。
const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
const CHUNK = 16 * 1024;

export function createP2P(sendSignal, update) {
    const outgoing = new Map(); // fileId -> File
    const peers = new Map();    // `${fileId}:${peerId}` -> { pc, buf }

    function peer(fileId, other) {
        const pc = new RTCPeerConnection({ iceServers: ICE });
        const entry = { pc, buf: [] };
        peers.set(fileId + ":" + other, entry);
        pc.onicecandidate = e => e.candidate && sendSignal(other, { f: fileId, s: "ice", p: e.candidate.toJSON() });
        return entry;
    }

    // 回報進度時每 1% 才更新一次，避免狂觸發重繪
    function progress(fileId, state, pct, last) {
        const p = Math.floor(pct * 100);
        if (p !== last.p) { last.p = p; update(fileId, { state, progress: pct }); }
    }

    function share(file) {
        const id = crypto.randomUUID();
        outgoing.set(id, file);
        return id;
    }

    function receive(fileId, from, name, size) {
        const { pc } = peer(fileId, from);
        const chunks = [];
        const last = {};
        let got = 0, started = false;
        const timer = setTimeout(() => {
            if (started) return;
            update(fileId, { state: "failed", note: "連線逾時：對方可能已離開，或網路不支援直連" });
            pc.close();
        }, 20000);
        pc.ondatachannel = ({ channel: dc }) => {
            dc.binaryType = "arraybuffer";
            dc.onmessage = e => {
                if (typeof e.data === "string") {
                    clearTimeout(timer);
                    const url = URL.createObjectURL(new Blob(chunks));
                    update(fileId, { state: "done", progress: 1, url });
                    const a = Object.assign(document.createElement("a"), { href: url, download: name });
                    a.click();
                    try { dc.send("ok"); } catch {}
                    setTimeout(() => pc.close(), 1000);
                    return;
                }
                started = true;
                clearTimeout(timer);
                chunks.push(e.data);
                got += e.data.byteLength;
                progress(fileId, "receiving", size ? got / size : 1, last);
            };
        };
        update(fileId, { state: "connecting" });
        sendSignal(from, { f: fileId, s: "req" });
    }

    async function serve(fileId, to) {
        const file = outgoing.get(fileId);
        if (!file) return sendSignal(to, { f: fileId, s: "gone" });
        const { pc } = peer(fileId, to);
        const dc = pc.createDataChannel("file");
        const last = {};
        dc.binaryType = "arraybuffer";
        dc.bufferedAmountLowThreshold = 1 << 20;
        dc.onopen = async () => {
            for (let off = 0; off < file.size; off += CHUNK) {
                if (dc.bufferedAmount > 4 << 20) await new Promise(r => { dc.onbufferedamountlow = r; });
                dc.send(await file.slice(off, off + CHUNK).arrayBuffer());
                progress(fileId, "sending", Math.min(1, (off + CHUNK) / file.size), last);
            }
            dc.send("EOF");
        };
        dc.onmessage = e => e.data === "ok" && update(fileId, { state: "sent" });
        await pc.setLocalDescription(await pc.createOffer());
        sendSignal(to, { f: fileId, s: "offer", p: pc.localDescription.toJSON() });
    }

    async function handle(from, { f, s, p }) {
        if (s === "req") return serve(f, from);
        const entry = peers.get(f + ":" + from);
        if (!entry) return;
        const { pc } = entry;
        if (s === "gone") {
            update(f, { state: "failed", note: "對方已重新整理或關閉頁面，請請他重新傳送" });
            pc.close();
        } else if (s === "offer" || s === "answer") {
            await pc.setRemoteDescription(p);
            for (const c of entry.buf.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            if (s === "offer") {
                await pc.setLocalDescription(await pc.createAnswer());
                sendSignal(from, { f, s: "answer", p: pc.localDescription.toJSON() });
            }
        } else if (s === "ice") {
            if (pc.remoteDescription) await pc.addIceCandidate(p).catch(() => {});
            else entry.buf.push(p);
        }
    }

    const owns = fileId => outgoing.has(fileId);
    return { share, receive, handle, owns };
}

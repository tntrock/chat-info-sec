import { DurableObject } from "cloudflare:workers";

// 伺服器只當加密訊息的中繼站：看不到內容、暱稱，只知道「誰在何時送了多大的密文」。
const MAX_USERS = 50;
const MAX_HISTORY = 200;
const MAX_CIPHER = 700_000;   // 內嵌圖片上限約 350KB，加密+base64 後落在這之內
const MAX_NAME = 512;          // 加密後的暱稱
const MAX_SIGNAL = 20_000;
const BURST = 8;               // 速率限制：token bucket，可連發 8 則
const REFILL_PER_SEC = 3;      // 之後每秒補 3 則
const MAX_AUTH_FAILS = 5;
const AUTH_RE = /^[0-9a-f]{64}$/;

async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

export class ChatRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.schema();
    }

    schema() {
        this.sql.exec(`CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, ts INTEGER, c TEXT);
                       CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
    }

    meta(ws) {
        try { return ws.deserializeAttachment() || {}; } catch { return {}; }
    }

    members(exclude) {
        return this.ctx.getWebSockets().filter(ws => ws !== exclude && this.meta(ws).authed);
    }

    broadcast(obj, exclude) {
        const s = JSON.stringify(obj);
        for (const ws of this.members(exclude)) { try { ws.send(s); } catch {} }
    }

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("expected websocket", { status: 426 });
        }
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        if (this.ctx.getWebSockets().length > MAX_USERS) {
            server.close(4001, "room full");
        } else {
            server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), authed: false, fails: 0, tokens: BURST, last: Date.now() });
        }
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, raw) {
        if (typeof raw !== "string" || raw.length > MAX_CIPHER + 1000) return;
        let d;
        try { d = JSON.parse(raw); } catch { return; }
        const me = this.meta(ws);
        if (!me.id) return;

        if (d.t === "join") {
            if (me.authed || !AUTH_RE.test(d.auth) || !isStr(d.name, MAX_NAME)) return;
            const hash = await sha256(d.auth);
            // 第一個進房的人決定房間的驗證雜湊；OR IGNORE 避免兩人同時建立時互相覆蓋
            this.sql.exec("INSERT OR IGNORE INTO meta (k, v) VALUES ('auth', ?)", hash);
            const stored = this.sql.exec("SELECT v FROM meta WHERE k = 'auth'").one().v;
            if (stored !== hash) {
                me.fails++;
                ws.serializeAttachment(me);
                if (me.fails >= MAX_AUTH_FAILS) ws.close(4003, "too many attempts");
                else ws.send(JSON.stringify({ t: "auth-fail" }));
                return;
            }
            me.authed = true;
            me.name = d.name;
            ws.serializeAttachment(me);
            const history = this.sql.exec("SELECT id, sender AS \"from\", ts, c FROM msgs ORDER BY id").toArray();
            const users = this.members(ws).map(w => { const m = this.meta(w); return { id: m.id, name: m.name }; });
            ws.send(JSON.stringify({ t: "hello", you: me.id, history, users }));
            this.broadcast({ t: "join", id: me.id, name: me.name }, ws);
            return;
        }

        if (!me.authed) return;

        if (d.t === "msg") {
            if (!isStr(d.c, MAX_CIPHER)) return;
            const now = Date.now();
            me.tokens = Math.min(BURST, me.tokens + (now - me.last) * REFILL_PER_SEC / 1000);
            me.last = now;
            const allowed = me.tokens >= 1;
            if (allowed) me.tokens -= 1;
            ws.serializeAttachment(me);
            if (!allowed) { ws.send(JSON.stringify({ t: "slow" })); return; }
            const { id } = this.sql.exec("INSERT INTO msgs (sender, ts, c) VALUES (?, ?, ?) RETURNING id", me.id, now, d.c).one();
            this.sql.exec("DELETE FROM msgs WHERE id <= ?", id - MAX_HISTORY);
            this.broadcast({ t: "msg", id, from: me.id, ts: now, c: d.c });
        } else if (d.t === "name") {
            if (!isStr(d.name, MAX_NAME)) return;
            me.name = d.name;
            ws.serializeAttachment(me);
            this.broadcast({ t: "name", id: me.id, name: d.name });
        } else if (d.t === "typing") {
            this.broadcast({ t: "typing", id: me.id }, ws);
        } else if (d.t === "signal") {
            if (!isStr(d.c, MAX_SIGNAL) || typeof d.to !== "string") return;
            const target = this.members(ws).find(w => this.meta(w).id === d.to);
            try { target?.send(JSON.stringify({ t: "signal", from: me.id, c: d.c })); } catch {}
        }
    }

    async webSocketClose(ws) { await this.leave(ws); }
    async webSocketError(ws) { await this.leave(ws); }

    async leave(ws) {
        const me = this.meta(ws);
        try { ws.close(1000); } catch {}
        if (me.authed) this.broadcast({ t: "leave", id: me.id }, ws);
        if (this.ctx.getWebSockets().every(w => w === ws)) {
            // 最後一人離開 → 房間內容、驗證雜湊全部銷毀
            await this.ctx.storage.deleteAll();
            this.schema();
        }
    }
}

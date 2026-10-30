import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { deriveKeys, seal, open, randomSecret, toB64 } from "../src/client/crypto.js";

async function connect(room) {
    const res = await SELF.fetch(`http://x/r/${room}`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    ws.accept();
    const inbox = [];
    const waiters = [];
    ws.addEventListener("message", e => {
        const d = JSON.parse(e.data);
        const w = waiters.findIndex(x => x.t === d.t);
        if (w >= 0) waiters.splice(w, 1)[0].res(d);
        else inbox.push(d);
    });
    const next = t => {
        const i = inbox.findIndex(d => d.t === t);
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
        return new Promise(res => waiters.push({ t, res }));
    };
    const closed = new Promise(res => ws.addEventListener("close", e => res(e.code)));
    return { ws, next, inbox, closed, send: o => ws.send(JSON.stringify(o)) };
}

const AUTH = "a".repeat(64);
let n = 0;
const room = () => "ROOM" + String(++n).padStart(5, "0");

async function joined(r, name = "enc", auth = AUTH) {
    const c = await connect(r);
    c.send({ t: "join", auth, name });
    c.hello = await c.next("hello");
    return c;
}

describe("crypto", () => {
    it("round-trips and rejects the wrong key", async () => {
        const a = await deriveKeys("hunter2", "ROOMCODE1");
        const b = await deriveKeys("hunter3", "ROOMCODE1");
        expect(a.auth).toMatch(/^[0-9a-f]{64}$/);
        expect(a.auth).not.toBe(b.auth);
        const c = await seal(a.key, { k: "text", text: "嗨" });
        expect(await open(a.key, c)).toEqual({ k: "text", text: "嗨" });
        await expect(open(b.key, c)).rejects.toThrow();
    });

    it("makes url-safe random secrets", () => {
        const s = randomSecret();
        expect(s).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(randomSecret()).not.toBe(s);
    });

    it("base64-encodes inputs larger than one chunk", () => {
        const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
        expect(atob(toB64(big))).toBe("A".repeat(big.length));
    });
});

describe("worker", () => {
    it("routes only /r/<room> websocket upgrades", async () => {
        expect((await SELF.fetch("http://x/r/bad")).status).toBe(400);
        expect((await SELF.fetch("http://x/nope")).status).toBe(404);
        expect((await SELF.fetch("http://x/r/ROOMCODE1")).status).toBe(426);
    });

    it("gates on the auth token and relays ciphertext", async () => {
        const good = "a".repeat(64), bad = "b".repeat(64);
        const alice = await connect("TESTROOM1");
        alice.send({ t: "join", auth: good, name: "enc-alice" });
        const hello = await alice.next("hello");
        expect(hello.history).toEqual([]);

        const mallory = await connect("TESTROOM1");
        mallory.send({ t: "join", auth: bad, name: "enc-m" });
        await mallory.next("auth-fail");

        alice.send({ t: "msg", c: "CIPHERTEXT" });
        const echoed = await alice.next("msg");
        expect(echoed).toMatchObject({ from: hello.you, c: "CIPHERTEXT" });

        const bob = await connect("TESTROOM1");
        bob.send({ t: "join", auth: good, name: "enc-bob" });
        const bobHello = await bob.next("hello");
        expect(bobHello.history.map(m => m.c)).toEqual(["CIPHERTEXT"]);
        expect(bobHello.users).toEqual([{ id: hello.you, name: "enc-alice" }]);
        expect((await alice.next("join")).name).toBe("enc-bob");
    });
});


describe("room", () => {
    it("relays names, typing and signals; ignores junk", async () => {
        const r = room();
        const a = await joined(r, "enc-a");
        const b = await joined(r, "enc-b");
        await a.next("join");

        // 未驗證、格式錯誤、二進位、非法欄位都應被忽略
        const anon = await connect(r);
        anon.send({ t: "msg", c: "x" });
        anon.ws.send("not json");
        anon.ws.send(new Uint8Array([1, 2]));
        anon.send({ t: "join", auth: "short", name: "x" });
        b.send({ t: "join", auth: AUTH, name: "again" });
        b.send({ t: "msg", c: "" });
        b.send({ t: "name", name: "" });
        b.send({ t: "signal", c: "s", to: 42 });
        b.send({ t: "signal", c: "s", to: "nobody00" });

        b.send({ t: "name", name: "enc-b2" });
        expect(await a.next("name")).toEqual({ t: "name", id: b.hello.you, name: "enc-b2" });

        b.send({ t: "typing" });
        expect(await a.next("typing")).toEqual({ t: "typing", id: b.hello.you });

        b.send({ t: "signal", c: "SDP", to: a.hello.you });
        expect(await a.next("signal")).toEqual({ t: "signal", from: b.hello.you, c: "SDP" });

        anon.ws.close();
        b.ws.close();
        expect(await a.next("leave")).toEqual({ t: "leave", id: b.hello.you });
        expect(a.inbox.filter(d => d.t === "msg")).toEqual([]);
    });

    it("rate-limits bursts", async () => {
        const a = await joined(room());
        for (let i = 0; i < 10; i++) a.send({ t: "msg", c: "m" + i });
        await a.next("slow");
    });

    it("closes after too many bad passwords", async () => {
        const r = room();
        await joined(r);
        const m = await connect(r);
        for (let i = 0; i < 5; i++) m.send({ t: "join", auth: "b".repeat(64), name: "m" });
        expect(await m.closed).toBe(4003);
    });

    it("rejects the 51st member", async () => {
        const r = room();
        const all = [];
        for (let i = 0; i < 50; i++) all.push(await connect(r));
        const extra = await connect(r);
        expect(await extra.closed).toBe(4001);
    });

    it("wipes history and password when the last member leaves", async () => {
        const r = room();
        const a = await joined(r);
        a.send({ t: "msg", c: "secret" });
        await a.next("msg");
        a.ws.close();
        // 關閉是非同步的：用新密碼重試，直到房間被清空
        for (let i = 0; i < 50; i++) {
            const c = await connect(r);
            c.send({ t: "join", auth: "c".repeat(64), name: "enc" });
            const d = await Promise.race([c.next("hello"), c.next("auth-fail")]);
            c.ws.close();
            if (d.t === "hello") { expect(d.history).toEqual([]); return; }
            await new Promise(res => setTimeout(res, 20));
        }
        throw new Error("room was not wiped");
    });
});

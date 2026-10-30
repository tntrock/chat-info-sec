import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { deriveKeys, seal, open } from "../src/client/crypto.js";
import { randomInt, validFrame } from "../src/client/util.js";

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
    return { ws, next, send: o => ws.send(JSON.stringify(o)) };
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
});

describe("worker", () => {
    it("rejects bad room codes", async () => {
        expect((await SELF.fetch("http://x/r/bad")).status).toBe(400);
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

describe("util", () => {
    it("drops frames with malformed user ids", () => {
        expect(validFrame({ t: "join", id: "a1b2c3d4", name: "x" })).toBe(true);
        expect(validFrame({ t: "msg", id: 7, from: "a1b2c3d4" })).toBe(true);
        expect(validFrame({ t: "join", id: "__proto__" })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [{ id: "constructor" }], history: [] })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [], history: [{ from: "__proto__" }] })).toBe(false);
    });
    it("randomInt stays in range", () => {
        for (let i = 0; i < 1000; i++) {
            const r = randomInt(10);
            expect(r >= 0 && r < 10 && Number.isInteger(r)).toBe(true);
        }
    });
});

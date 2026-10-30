import { describe, it, expect, vi, afterEach } from "vitest";
import {
    ROOM_RE, randomInt, randomRoom, randomName, validFrame, parseInvite, fmtSize, fmtTime, hueFor,
    store, roomSecret, applyTheme, initialTheme, compressImage, INLINE_IMAGE_MAX,
} from "../src/client/util.js";

// Workers runtime 沒有 DOM / Web Storage，只補測試需要的最小介面
function fakeStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };

afterEach(() => vi.unstubAllGlobals());

describe("random", () => {
    it("randomInt stays in range", () => {
        for (let i = 0; i < 1000; i++) {
            const r = randomInt(10);
            expect(r >= 0 && r < 10 && Number.isInteger(r)).toBe(true);
        }
    });
    it("randomInt rejects values in the biased tail", () => {
        const spy = vi.spyOn(crypto, "getRandomValues")
            .mockImplementationOnce(b => { b[0] = 2 ** 32 - 1; return b; })
            .mockImplementationOnce(b => { b[0] = 7; return b; });
        expect(randomInt(10)).toBe(7);
        spy.mockRestore();
    });
    it("makes valid room codes and names", () => {
        expect(randomRoom()).toMatch(ROOM_RE);
        expect(randomName()).toMatch(/^.+的.+$/);
    });
});

describe("validFrame", () => {
    it("drops frames with malformed user ids", () => {
        expect(validFrame({ t: "join", id: "a1b2c3d4", name: "x" })).toBe(true);
        expect(validFrame({ t: "msg", id: 7, from: "a1b2c3d4" })).toBe(true);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [{ id: "00ff00ff" }], history: [{ from: "a1b2c3d4" }] })).toBe(true);
        expect(validFrame(null)).toBe(false);
        expect(validFrame("x")).toBe(false);
        expect(validFrame({ t: "join", id: "__proto__" })).toBe(false);
        expect(validFrame({ t: "signal", from: "constructor" })).toBe(false);
        expect(validFrame({ t: "hello", you: 1 })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: "x" })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [{ id: "constructor" }], history: [] })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [], history: [{ from: "__proto__" }] })).toBe(false);
        expect(validFrame({ t: "hello", you: "a1b2c3d4", users: [], history: {} })).toBe(false);
    });
});

describe("parseInvite", () => {
    it("accepts links and bare codes", () => {
        expect(parseInvite(" https://x.test/?room=abcd1234#k%2By ")).toEqual({ room: "ABCD1234", secret: "k+y" });
        expect(parseInvite("https://x.test/?room=ABCD1234")).toEqual({ room: "ABCD1234", secret: null });
        expect(parseInvite("abcd1234")).toEqual({ room: "ABCD1234", secret: null });
        expect(parseInvite("https://x.test/?room=no")).toBe(null);
        expect(parseInvite("nope")).toBe(null);
    });
});

describe("format", () => {
    it("sizes, times and hues", () => {
        expect(fmtSize(512)).toBe("512 B");
        expect(fmtSize(1536)).toBe("1.5 KB");
        expect(fmtSize(5 * 1024 ** 4)).toBe("5120.0 GB");
        expect(fmtTime(Date.UTC(2026, 0, 1, 13, 5))).toMatch(/\d{2}:\d{2}/);
        expect(hueFor()).toBe(0);
        expect(hueFor("abc")).toBe(hueFor("abc"));
        expect(hueFor("abc")).toBeLessThan(360);
    });
});

describe("storage", () => {
    it("round-trips and tolerates blocked storage", () => {
        vi.stubGlobal("localStorage", fakeStorage());
        vi.stubGlobal("sessionStorage", fakeStorage());
        expect(store.get("k", 1)).toBe(1);
        store.set("k", { a: 1 });
        expect(store.get("k")).toEqual({ a: 1 });
        roomSecret.set("R", { secret: "s", pw: false });
        expect(roomSecret.get("R")).toEqual({ secret: "s", pw: false });
        roomSecret.clear("R");
        expect(roomSecret.get("R")).toBe(null);

        vi.stubGlobal("localStorage", throwing);
        vi.stubGlobal("sessionStorage", throwing);
        expect(store.get("k", 2)).toBe(2);
        expect(() => store.set("k", 1)).not.toThrow();
        expect(roomSecret.get("R")).toBe(null);
        expect(() => roomSecret.set("R", 1)).not.toThrow();
        expect(() => roomSecret.clear("R")).not.toThrow();
    });
});

describe("theme", () => {
    it("applies and picks the initial theme", () => {
        const root = { dataset: {} };
        vi.stubGlobal("document", { documentElement: root });
        applyTheme("light");
        expect(root.dataset.theme).toBe("light");

        vi.stubGlobal("localStorage", fakeStorage());
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        expect(initialTheme()).toBe("light");
        vi.stubGlobal("matchMedia", () => ({ matches: false }));
        expect(initialTheme()).toBe("dark");
        store.set("theme", "light");
        expect(initialTheme()).toBe("light");
    });
});

describe("compressImage", () => {
    class FakeReader {
        readAsDataURL(b) { b.fail ? this.onerror(new Error("read")) : (this.result = "data:" + b.size, this.onload()); }
    }
    // sizes[i] = 第 i 次壓縮輸出的大小
    function fakeCanvas(sizes) {
        let i = 0;
        vi.stubGlobal("document", {
            createElement: () => ({
                getContext: () => ({ drawImage() {} }),
                toBlob(cb) { cb({ size: sizes[i++] }); },
            }),
        });
    }

    it("inlines small gifs and rejects big ones", async () => {
        vi.stubGlobal("FileReader", FakeReader);
        expect(await compressImage({ type: "image/gif", size: 10 })).toEqual({ src: "data:10" });
        expect(await compressImage({ type: "image/gif", size: INLINE_IMAGE_MAX + 1 })).toBe(null);
        await expect(compressImage({ type: "image/gif", size: 1, fail: true })).rejects.toThrow("read");
    });

    it("steps down quality until it fits", async () => {
        vi.stubGlobal("FileReader", FakeReader);
        vi.stubGlobal("createImageBitmap", async () => ({ width: 3200, height: 1600 }));
        fakeCanvas([INLINE_IMAGE_MAX + 1, 1000]);
        expect(await compressImage({ type: "image/png" })).toEqual({ src: "data:1000", w: 1200, h: 600 });

        fakeCanvas([INLINE_IMAGE_MAX + 1, INLINE_IMAGE_MAX + 1, INLINE_IMAGE_MAX + 1]);
        expect(await compressImage({ type: "image/png" })).toBe(null);
    });
});

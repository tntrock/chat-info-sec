// 所有內容在瀏覽器端用 AES-GCM 加密。房間「秘密」＝密碼，或（無密碼房）邀請連結 # 後面的隨機金鑰。
// 秘密經 PBKDF2 拆成兩半：前半是加密金鑰，後半是給伺服器比對的驗證 token（伺服器再雜湊一次才存）。
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function deriveKeys(secret, room) {
    const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("chat-info-sec:" + room), iterations: 310_000 },
        base, 512));
    const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
    const auth = [...bits.slice(32)].map(b => b.toString(16).padStart(2, "0")).join("");
    return { key, auth };
}

export async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return toB64(out);
}

export async function open(key, s) {
    const buf = fromB64(s);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12));
    return JSON.parse(dec.decode(pt));
}

export function randomSecret() {
    return toB64(crypto.getRandomValues(new Uint8Array(18))).replace(/\+/g, "-").replace(/\//g, "_");
}

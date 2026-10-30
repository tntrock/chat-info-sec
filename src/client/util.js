export const ROOM_RE = /^[A-Z0-9]{8,12}$/;

// 拒絕取樣：避免 % 造成的分布偏差
export function randomInt(n) {
    const lim = 2 ** 32 - (2 ** 32 % n), buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= lim);
    return buf[0] % n;
}

export function randomRoom() {
    const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 8 }, () => c[randomInt(c.length)]).join("");
}

const ADJ = ["安靜的", "迷路的", "熬夜的", "害羞的", "勇敢的", "神秘的", "慵懶的", "好奇的", "低調的", "路過的"];
const ANIMAL = ["水獺", "狐狸", "貓頭鷹", "企鵝", "樹懶", "刺蝟", "海豹", "浣熊", "柴犬", "黑貓"];
const pick = a => a[randomInt(a.length)];
export const randomName = () => pick(ADJ) + pick(ANIMAL);

// 使用者 id 會拿來當物件 key；格式不符（例如 "__proto__"）的封包整個丟掉
const UID_RE = /^[0-9a-f]{8}$/;
const isUid = s => typeof s === "string" && UID_RE.test(s);
export function validFrame(d) {
    if (!d || typeof d !== "object") return false;
    if (d.from !== undefined && !isUid(d.from)) return false;
    if (d.you !== undefined && !isUid(d.you)) return false;
    if (d.t !== "msg" && d.id !== undefined && !isUid(d.id)) return false;
    if (d.users !== undefined && !(Array.isArray(d.users) && d.users.every(u => isUid(u?.id)))) return false;
    return d.history === undefined || (Array.isArray(d.history) && d.history.every(h => isUid(h?.from)));
}

// 接受完整邀請連結或單純房號
export function parseInvite(input) {
    const v = input.trim();
    try {
        const u = new URL(v);
        const room = (u.searchParams.get("room") || "").toUpperCase();
        if (ROOM_RE.test(room)) return { room, secret: decodeURIComponent(u.hash.slice(1)) || null };
    } catch {}
    const room = v.toUpperCase();
    return ROOM_RE.test(room) ? { room, secret: null } : null;
}

export function fmtSize(b) {
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (b >= 1024 && i < 3) { b /= 1024; i++; }
    return `${i ? b.toFixed(1) : b} ${u[i]}`;
}

export const fmtTime = ts => new Date(ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });

export function hueFor(id = "") {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
}

export const store = {
    get(k, fallback = null) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// 房間秘密只放 sessionStorage：關掉分頁就消失
export const roomSecret = {
    get(room) { try { return JSON.parse(sessionStorage.getItem("room:" + room)); } catch { return null; } },
    set(room, v) { try { sessionStorage.setItem("room:" + room, JSON.stringify(v)); } catch {} },
    clear(room) { try { sessionStorage.removeItem("room:" + room); } catch {} },
};

export function applyTheme(t) {
    document.documentElement.dataset.theme = t;
}
export function initialTheme() {
    return store.get("theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

// 圖片壓縮後小於此大小就直接加密內嵌；更大的走 P2P
export const INLINE_IMAGE_MAX = 350 * 1024;

export async function compressImage(file) {
    if (file.type === "image/gif") {
        return file.size <= INLINE_IMAGE_MAX ? { src: await readDataURL(file) } : null;
    }
    const bmp = await createImageBitmap(file);
    for (const [max, q] of [[1600, 0.82], [1200, 0.75], [900, 0.68]]) {
        const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * s);
        c.height = Math.round(bmp.height * s);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, "image/webp", q));
        if (blob && blob.size <= INLINE_IMAGE_MAX) return { src: await readDataURL(blob), w: c.width, h: c.height };
    }
    return null;
}

const readDataURL = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
});

import { useEffect, useState } from "react";
import { randomSecret } from "./crypto.js";
import { parseInvite, randomRoom, roomSecret } from "./util.js";
import { Icon, ThemeToggle } from "./ui.jsx";

const HEADLINE = "只有你們看得懂的聊天室";
const GLYPHS = "＃％＆＄＠０１２３４５６７８９ＡＢＣＤＥＦ";

// 標題從密文「解密」成中文：整頁唯一的一段自動動畫
function Decrypt({ text }) {
    const [out, setOut] = useState(text);
    useEffect(() => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const start = performance.now();
        const dur = 1200;
        let raf;
        const tick = now => {
            const k = Math.min(1, (now - start) / dur);
            const n = Math.floor(k * text.length);
            setOut([...text].map((c, i) => (i < n ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(""));
            if (k < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [text]);
    return <span aria-hidden="true">{out}</span>;
}

export default function Lobby() {
    const [pw, setPw] = useState("");
    const [invite, setInvite] = useState("");
    const [err, setErr] = useState("");

    const create = e => {
        e.preventDefault();
        const room = randomRoom();
        roomSecret.set(room, { secret: pw || randomSecret(), pw: !!pw });
        location.href = `/?room=${room}`;
    };

    const join = e => {
        e.preventDefault();
        const inv = parseInvite(invite);
        if (!inv) return setErr("房號是 8–12 碼英文或數字，或直接貼上完整邀請連結。");
        if (inv.secret) roomSecret.set(inv.room, { secret: inv.secret, pw: false });
        location.href = `/?room=${inv.room}`;
    };

    return (
        <div className="lobby">
            <header className="topbar">
                <span className="brand"><span className="seal sm"><Icon name="lock" size={14} /></span>chat.info-sec.vip</span>
                <ThemeToggle />
            </header>

            <main className="lobby-main">
                <h1 className="hero-title" aria-label={HEADLINE}><Decrypt text={HEADLINE} /></h1>
                <p className="hero-sub">
                    訊息在你的瀏覽器裡加密，伺服器只看得到亂碼。不用註冊，所有人離開後，房間和紀錄一起消失。
                </p>

                <div className="doors">
                    <form className="door door-create" onSubmit={create}>
                        <h2>開新房間</h2>
                        <label className="label" htmlFor="pw">房間密碼<span className="opt">（選填）</span></label>
                        <input id="pw" className="field" type="password" maxLength={128} autoComplete="new-password"
                            value={pw} onChange={e => setPw(e.target.value)} placeholder="留空也可以" />
                        <p className="hint">
                            {pw
                                ? "朋友需要房號和這組密碼才能進來。密碼忘了就找不回來。"
                                : "不設密碼時，邀請連結本身就是鑰匙，拿到連結的人都能進來。"}
                        </p>
                        <button className="btn primary">建立房間</button>
                    </form>

                    <form className="door door-join" onSubmit={join}>
                        <h2>加入房間</h2>
                        <label className="label" htmlFor="invite">邀請連結或房號</label>
                        <input id="invite" className="field mono" autoComplete="off" spellCheck={false}
                            value={invite} onChange={e => { setInvite(e.target.value); setErr(""); }}
                            placeholder="貼上連結，或輸入房號" />
                        <p className={err ? "hint error" : "hint"} role="alert">{err || "只有房號時，進房後會請你輸入密碼。"}</p>
                        <button className="btn">加入房間</button>
                    </form>
                </div>

                <details className="how">
                    <summary>它怎麼保護你的訊息</summary>
                    <ul>
                        <li><b>端對端加密。</b>訊息、圖片、暱稱都用 AES-256-GCM 在你的裝置上加密，金鑰從房間密碼（或邀請連結裡 # 後的隨機金鑰）推導出來，永遠不會傳到伺服器。</li>
                        <li><b>離開即焚。</b>房間最多保留最近 200 則密文；最後一個人離開時，全部刪除。</li>
                        <li><b>檔案點對點。</b>超過 350 KB 的圖片和檔案直接在雙方瀏覽器之間傳輸，不經過伺服器，所以傳送方要留在頁面上。有些公司或校園網路會擋直連，這時會顯示連線逾時。</li>
                        <li><b>不載入外部圖片。</b>訊息裡的連結不會自動預覽，避免有人用追蹤圖取得你的 IP。</li>
                    </ul>
                </details>
            </main>
        </div>
    );
}

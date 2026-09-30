import { memo, useMemo } from "react";
import { renderMarkdown } from "./markdown.js";
import { fmtSize, fmtTime } from "./util.js";
import { Avatar, Icon } from "./ui.jsx";

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const GROUP_WINDOW = 5 * 60 * 1000;

export function snippet(m) {
    if (!m) return "原訊息已不在紀錄中";
    if (m.k === "text") return m.text.slice(0, 80);
    if (m.k === "image") return "圖片";
    if (m.k === "file") return "檔案：" + m.name;
    return "無法解密的訊息";
}

const isImageSrc = s => typeof s === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(s);

function FileCard({ m, mine, owned, st = {}, onDownload }) {
    const pct = Math.round((st.progress || 0) * 100);
    let status, action = null;
    if (mine) {
        status = st.note || {
            sending: `傳送中 ${pct}%`,
            sent: "對方已收到",
        }[st.state] || (owned ? "保持這個頁面開著，別人才能下載" : "這個檔案已失效（頁面重新整理過）");
    } else {
        status = st.note || {
            connecting: "正在建立直連…",
            receiving: `下載中 ${pct}%`,
            done: "已儲存到你的裝置",
        }[st.state] || "對方在線時才能下載";
        if (!st.state || st.state === "failed") {
            action = <button className="chip-btn" onClick={onDownload}><Icon name="down" size={14} />{st.state ? "重試" : "下載"}</button>;
        } else if (st.state === "done") {
            action = <a className="chip-btn" href={st.url} download={m.name}>再存一次</a>;
        }
    }
    const busy = st.state === "sending" || st.state === "receiving";
    return (
        <div className="filecard">
            <div className="file-row">
                <span className="file-icon"><Icon name="file" /></span>
                <div className="file-meta">
                    <div className="file-name">{m.name}</div>
                    <div className="file-size">{fmtSize(m.size)}</div>
                </div>
                {action}
            </div>
            {busy && <div className="bar"><span style={{ width: pct + "%" }} /></div>}
            <div className={st.state === "failed" ? "file-status error" : "file-status"}>{status}</div>
        </div>
    );
}

function Body({ m, onOpenImage, fileProps }) {
    const html = useMemo(() => (m.k === "text" ? renderMarkdown(m.text) : ""), [m]);
    if (m.k === "text") return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
    if (m.k === "image" && isImageSrc(m.src)) {
        return (
            <button className="img-btn" onClick={() => onOpenImage(m.src)} aria-label="放大圖片">
                <img src={m.src} alt="" style={m.w && m.h ? { aspectRatio: `${m.w} / ${m.h}` } : undefined} />
            </button>
        );
    }
    if (m.k === "file" && typeof m.name === "string") return <FileCard m={m} {...fileProps} />;
    return <div className="broken">無法解密這則訊息</div>;
}

function Message({ m, prev, mine, name, reactions, replied, myId, fileState, owned,
    onReply, onReact, onOpenImage, onDownload, onJump }) {
    if (m.k === "sys") return <div className="sys">{m.text}</div>;

    const grouped = prev && prev.k !== "sys" && prev.from === m.from && m.ts - prev.ts < GROUP_WINDOW && !m.reply;
    const media = m.k === "image";
    const chips = Object.entries(reactions || {}).filter(([, s]) => s.size);

    return (
        <div className={`msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`} id={"m" + m.id} tabIndex={-1}>
            {!grouped && (
                <div className="msg-head">
                    {!mine && <Avatar id={m.from} name={name} />}
                    <b>{mine ? "你" : name}</b>
                    <time dateTime={new Date(m.ts).toISOString()}>{fmtTime(m.ts)}</time>
                </div>
            )}
            <div className="bubble-wrap">
                <div className={`bubble${media ? " media" : ""}`} title={grouped ? fmtTime(m.ts) : undefined}>
                    {m.reply && (
                        <button className="quote" onClick={() => onJump(m.reply)}>
                            {snippet(replied)}
                        </button>
                    )}
                    <Body m={m} onOpenImage={onOpenImage}
                        fileProps={{ mine, owned, st: fileState, onDownload: () => onDownload(m) }} />
                </div>
                <div className="actions" role="toolbar" aria-label="訊息動作">
                    {REACTIONS.map(e => (
                        <button key={e} onClick={() => onReact(m.id, e)} aria-label={"回應 " + e}>{e}</button>
                    ))}
                    <button onClick={() => onReply(m)} aria-label="回覆" title="回覆"><Icon name="reply" size={16} /></button>
                </div>
            </div>
            {chips.length > 0 && (
                <div className="reacts">
                    {chips.map(([e, s]) => (
                        <button key={e} className={s.has(myId) ? "react-chip on" : "react-chip"}
                            onClick={() => onReact(m.id, e)} aria-pressed={s.has(myId)}>
                            {e} {s.size}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default memo(Message);

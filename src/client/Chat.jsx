import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deriveKeys, open, seal } from "./crypto.js";
import { createP2P } from "./p2p.js";
import { compressImage, parseInvite, randomName, roomSecret, store, validFrame } from "./util.js";
import { Avatar, Icon, ThemeToggle } from "./ui.jsx";
import Message, { REACTIONS, snippet } from "./Message.jsx";

const MAX_TEXT = 4000;

export default function Chat({ room }) {
    const [creds, setCreds] = useState(() => {
        const h = decodeURIComponent(location.hash.slice(1));
        if (h) {
            roomSecret.set(room, { secret: h, pw: false });
            // 金鑰不留在網址列，避免被截圖或瀏覽紀錄帶走
            history.replaceState(null, "", location.pathname + location.search);
        }
        return roomSecret.get(room);
    });
    const [keys, setKeys] = useState(null);
    const [gateError, setGateError] = useState("");

    useEffect(() => {
        if (!creds) return;
        let dead = false;
        deriveKeys(creds.secret, room).then(k => !dead && setKeys(k));
        return () => { dead = true; };
    }, [creds, room]);

    const authFail = useCallback(msg => {
        roomSecret.clear(room);
        setKeys(null);
        setCreds(null);
        setGateError(msg);
    }, [room]);

    if (!creds || !keys) {
        return <Gate room={room} error={gateError} busy={!!creds}
            onSubmit={c => { setGateError(""); roomSecret.set(room, c); setCreds(c); }} />;
    }
    return <Room room={room} creds={creds} keys={keys} onAuthFail={authFail} />;
}

function Gate({ room, error, busy, onSubmit }) {
    const [v, setV] = useState("");
    const submit = e => {
        e.preventDefault();
        if (!v || busy) return;
        const inv = parseInvite(v);
        if (inv?.secret) {
            if (inv.room !== room) location.href = `/?room=${inv.room}#${encodeURIComponent(inv.secret)}`;
            else onSubmit({ secret: inv.secret, pw: false });
        } else {
            onSubmit({ secret: v, pw: true });
        }
    };
    return (
        <div className="gate">
            <form className="gate-card" onSubmit={submit}>
                <span className="seal lg"><Icon name="lock" size={26} /></span>
                <div className="room-code">{room}</div>
                <p>這個房間的訊息是加密的。輸入房間密碼，或貼上完整的邀請連結。</p>
                <input className="field" type="password" autoFocus value={v} onChange={e => setV(e.target.value)}
                    placeholder="房間密碼或邀請連結" aria-label="房間密碼或邀請連結" />
                <p className="hint error" role="alert">{error}</p>
                <button className="btn primary" disabled={busy}>{busy ? "正在產生金鑰…" : "進入房間"}</button>
                <p className="gate-note">
                    房間不存在時，你輸入的密碼會成為這個房間的新密碼。<a href="/">回首頁</a>
                </p>
            </form>
        </div>
    );
}

function Room({ room, creds, keys, onAuthFail }) {
    const { key, auth } = keys;
    const [name, setName] = useState(() => store.get("name") || randomName());
    const [status, setStatus] = useState("connecting");
    const [fatal, setFatal] = useState("");
    const [me, setMe] = useState(null);
    const [users, setUsers] = useState({});
    const [events, setEvents] = useState([]);
    const [files, setFiles] = useState({});
    const [typing, setTyping] = useState({});
    const [replyTo, setReplyTo] = useState(null);
    const [drawer, setDrawer] = useState(false);
    const [copied, setCopied] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [viewing, setViewing] = useState(null);
    const [notify, setNotify] = useState(() =>
        store.get("notify", false) && "Notification" in window && Notification.permission === "granted");

    const wsRef = useRef(null);
    const nameRef = useRef(name);
    const usersRef = useRef(users);
    const notifyRef = useRef(notify);
    const sendQ = useRef(Promise.resolve());
    const unread = useRef(0);
    const viewer = useRef(null);
    nameRef.current = name;
    usersRef.current = users;
    notifyRef.current = notify;

    // 重新連線會拿到新 id；把這個分頁用過的 id 都記住，才認得出哪些是自己的舊訊息
    const myIds = useRef(null);
    if (!myIds.current) {
        try { myIds.current = new Set(JSON.parse(sessionStorage.getItem("ids:" + room)) || []); }
        catch { myIds.current = new Set(); }
    }

    const sendRaw = useCallback(obj => {
        const ws = wsRef.current;
        if (ws?.readyState !== 1) return false;
        ws.send(JSON.stringify(obj));
        return true;
    }, []);

    const [p2p] = useState(() => createP2P(
        async (to, data) => sendRaw({ t: "signal", to, c: await seal(key, data) }),
        (id, patch) => setFiles(f => ({ ...f, [id]: { ...f[id], ...patch } })),
    ));

    useEffect(() => {
        let closed = false, retry = 0, timer, queue = Promise.resolve();

        const decrypt = async c => { try { return await open(key, c); } catch { return null; } };
        const decName = async c => {
            const n = await decrypt(c);
            return typeof n === "string" && n ? n.slice(0, 24) : "無法辨識的人";
        };
        // 伺服器給的 id/from/ts 放最後，別人塞在密文裡的同名欄位蓋不過去
        const decMsg = async d => {
            const p = await decrypt(d.c);
            const safe = p && typeof p === "object" ? p : { k: "broken" };
            return { ...safe, n: typeof safe.n === "string" ? safe.n.slice(0, 24) : "", id: d.id, from: d.from, ts: d.ts };
        };
        const sys = text => setEvents(ev => [...ev, { k: "sys", text, id: "s" + Math.random(), ts: Date.now() }]);

        const alertNew = m => {
            if (!document.hidden) return;
            unread.current++;
            document.title = `(${unread.current}) 匿名聊天室`;
            if (notifyRef.current) {
                // 通知內容刻意不顯示訊息，避免在鎖定畫面上外洩
                try { new Notification(`${m.n || "有人"} 傳來新訊息`, { body: `房間 ${room}`, tag: room }); } catch {}
            }
        };

        const handle = async d => {
            switch (d.t) {
                case "auth-fail":
                    closed = true;
                    wsRef.current.close();
                    onAuthFail(creds.pw ? "密碼不對，再試一次。" : "邀請連結裡的金鑰不對，請對方重新複製一次連結。");
                    return;
                case "hello": {
                    myIds.current.add(d.you);
                    try { sessionStorage.setItem("ids:" + room, JSON.stringify([...myIds.current])); } catch {}
                    const u = {};
                    for (const x of d.users) u[x.id] = await decName(x.name);
                    u[d.you] = nameRef.current;
                    setMe(d.you);
                    setUsers(u);
                    setEvents(await Promise.all(d.history.map(decMsg)));
                    setStatus("online");
                    return;
                }
                case "msg": {
                    const m = await decMsg(d);
                    setEvents(ev => [...ev, m]);
                    setTyping(t => { const { [d.from]: _, ...rest } = t; return rest; });
                    if (!myIds.current.has(d.from) && m.k !== "react") alertNew(m);
                    return;
                }
                case "join": {
                    const n = await decName(d.name);
                    setUsers(u => ({ ...u, [d.id]: n }));
                    sys(`${n} 進入了房間`);
                    return;
                }
                case "leave": {
                    const n = usersRef.current[d.id];
                    setUsers(u => { const { [d.id]: _, ...rest } = u; return rest; });
                    if (n) sys(`${n} 離開了`);
                    return;
                }
                case "name": {
                    const n = await decName(d.name);
                    const old = usersRef.current[d.id];
                    setUsers(u => ({ ...u, [d.id]: n }));
                    if (old && old !== n) sys(`${old} 改名為 ${n}`);
                    return;
                }
                case "slow":
                    sys("傳得太快了，剛剛那則沒有送出，稍等一下再試。");
                    return;
                case "typing":
                    setTyping(t => ({ ...t, [d.id]: Date.now() + 3000 }));
                    setTimeout(() => setTyping(t => {
                        if (!(t[d.id] <= Date.now())) return t;
                        const { [d.id]: _, ...rest } = t;
                        return rest;
                    }), 3100);
                    return;
                case "signal": {
                    const data = await decrypt(d.c);
                    if (data) p2p.handle(d.from, data).catch(() => {});
                }
            }
        };

        const connect = () => {
            const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/r/${room}`);
            wsRef.current = ws;
            setStatus("connecting");
            ws.onopen = async () => {
                retry = 0;
                ws.send(JSON.stringify({ t: "join", auth, name: await seal(key, nameRef.current) }));
            };
            ws.onmessage = e => {
                let d;
                try { d = JSON.parse(e.data); } catch { return; }
                if (!validFrame(d)) return;
                queue = queue.then(() => handle(d)).catch(console.error);
            };
            ws.onclose = e => {
                if (closed) return;
                if (e.code === 4001) { setFatal("房間已滿，最多 50 人。"); return; }
                if (e.code === 4003) { onAuthFail("密碼錯誤太多次，請確認後再試。"); return; }
                setStatus("offline");
                timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
            };
        };

        connect();
        return () => { closed = true; clearTimeout(timer); wsRef.current?.close(); };
    }, [room, key, auth, creds.pw, onAuthFail, p2p]);

    useEffect(() => {
        const onVis = () => {
            if (document.hidden) return;
            unread.current = 0;
            document.title = "匿名聊天室";
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, []);

    const post = useCallback(payload => {
        sendQ.current = sendQ.current.then(async () => {
            const c = await seal(key, { ...payload, n: nameRef.current });
            sendRaw({ t: "msg", c });
        });
        return sendQ.current;
    }, [key, sendRaw]);

    const { list, reactions, byId } = useMemo(() => {
        const reactions = {}, byId = {}, list = [];
        for (const e of events) {
            if (e.k === "react") {
                if (!REACTIONS.includes(e.emoji)) continue;
                const r = (reactions[e.target] ??= {});
                const s = (r[e.emoji] ??= new Set());
                s.has(e.from) ? s.delete(e.from) : s.add(e.from);
                continue;
            }
            byId[e.id] = e;
            list.push(e);
        }
        return { list, reactions, byId };
    }, [events]);

    const sendText = text => {
        post({ k: "text", text: text.slice(0, MAX_TEXT), ...(replyTo && { reply: replyTo.id }) });
        setReplyTo(null);
    };

    const sendFiles = async fileList => {
        for (const f of fileList) {
            let img = null;
            if (f.type.startsWith("image/")) {
                try { img = await compressImage(f); } catch {}
            }
            if (img) {
                post({ k: "image", ...img, ...(replyTo && { reply: replyTo.id }) });
            } else {
                const fileId = p2p.share(f);
                post({ k: "file", fileId, name: f.name.slice(0, 200), size: f.size });
            }
        }
        setReplyTo(null);
    };

    const react = useCallback((target, emoji) => post({ k: "react", target, emoji }), [post]);
    const download = useCallback(m => p2p.receive(m.fileId, m.from, m.name, m.size), [p2p]);
    const jump = useCallback(id => {
        const el = document.getElementById("m" + id);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
    }, []);
    const openImage = useCallback(src => setViewing(src), []);

    useEffect(() => {
        if (viewing) viewer.current?.showModal();
    }, [viewing]);

    const typingNames = Object.keys(typing).filter(id => id !== me && users[id]).map(id => users[id]);

    const inviteLink = `${location.origin}/?room=${room}${creds.pw ? "" : "#" + encodeURIComponent(creds.secret)}`;
    const copyInvite = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            prompt("複製這個邀請連結：", inviteLink);
        }
    };

    const rename = async n => {
        n = n.trim().slice(0, 24);
        if (!n || n === name) return;
        setName(n);
        store.set("name", n);
        if (me) setUsers(u => ({ ...u, [me]: n }));
        sendRaw({ t: "name", name: await seal(key, n) });
    };

    const toggleNotify = async () => {
        if (notify) { setNotify(false); store.set("notify", false); return; }
        if (!("Notification" in window)) return;
        const ok = (await Notification.requestPermission()) === "granted";
        setNotify(ok);
        store.set("notify", ok);
    };

    const leave = () => {
        roomSecret.clear(room);
        location.href = "/";
    };

    if (fatal) {
        return (
            <div className="gate">
                <div className="gate-card">
                    <p>{fatal}</p>
                    <a className="btn primary" href="/">回首頁</a>
                </div>
            </div>
        );
    }

    const statusText = { online: "已連線，端對端加密", connecting: "連線中…", offline: "連線中斷，正在重新連線…" }[status];
    const userIds = Object.keys(users);

    return (
        <div className="room">
            <aside className={drawer ? "side open" : "side"} aria-label="房間資訊">
                <div className="side-head">
                    <span className="seal"><Icon name="lock" size={18} /></span>
                    <div className="side-title">
                        <div className="room-code">{room}</div>
                        <div className={"room-state " + status}>{statusText}</div>
                    </div>
                    <button className="icon-btn only-mobile" onClick={() => setDrawer(false)} aria-label="關閉">
                        <Icon name="x" />
                    </button>
                </div>

                <div className="invite">
                    <button className="btn primary" onClick={copyInvite}>
                        <Icon name={copied ? "check" : "copy"} size={16} />{copied ? "已複製" : "複製邀請連結"}
                    </button>
                    <p className="hint">
                        {creds.pw ? "連結不含密碼，密碼請用別的管道告訴對方。" : "連結本身就是鑰匙，只傳給你信任的人。"}
                    </p>
                </div>

                <section className="members">
                    <h2>在線 {userIds.length} 人</h2>
                    <ul>
                        {userIds.map(id => (
                            <li key={id}>
                                <Avatar id={id} name={users[id]} />
                                <span className="member-name">{users[id]}</span>
                                {id === me && <span className="you">你</span>}
                            </li>
                        ))}
                    </ul>
                </section>

                <div className="side-foot">
                    <NameEditor name={name} onRename={rename} />
                    <div className="side-actions">
                        <button className={notify ? "icon-btn on" : "icon-btn"} onClick={toggleNotify}
                            aria-pressed={notify} title={notify ? "關閉桌面通知" : "開啟桌面通知"} aria-label="桌面通知">
                            <Icon name={notify ? "bell" : "bellOff"} />
                        </button>
                        <ThemeToggle />
                        <button className="icon-btn danger" onClick={leave} title="離開房間" aria-label="離開房間">
                            <Icon name="leave" />
                        </button>
                    </div>
                </div>
            </aside>
            {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

            <main className="main"
                onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
                onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
                onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files]); }}>
                <header className="main-head">
                    <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="房間資訊與成員">
                        <Icon name="users" />
                    </button>
                    <div className="side-title">
                        <div className="room-code">{room}</div>
                        <div className={"room-state " + status}>{status === "online" ? `${userIds.length} 人在線，已加密` : statusText}</div>
                    </div>
                    <button className="icon-btn" onClick={copyInvite} aria-label="複製邀請連結">
                        <Icon name={copied ? "check" : "copy"} />
                    </button>
                </header>

                <MessageList list={list} status={status} myIds={myIds.current}>
                    {list.length === 0 && status === "online" && (
                        <div className="empty">
                            <p>房間是空的。先把邀請連結傳給朋友，或直接說聲嗨。</p>
                            <p className="hint">Enter 送出，Shift+Enter 換行。支援 Markdown 語法，也可以直接貼上或拖曳圖片。</p>
                        </div>
                    )}
                    {list.map((m, i) => (
                        <Message key={m.id} m={m} prev={list[i - 1]} mine={myIds.current.has(m.from)}
                            name={users[m.from] || m.n || "匿名"} reactions={reactions[m.id]}
                            replied={m.reply != null ? byId[m.reply] : undefined}
                            myId={me} fileState={m.k === "file" ? files[m.fileId] : undefined}
                            owned={m.k === "file" && p2p.owns(m.fileId)}
                            onReply={setReplyTo} onReact={react} onOpenImage={openImage}
                            onDownload={download} onJump={jump} />
                    ))}
                </MessageList>

                <Composer disabled={status !== "online"} replyTo={replyTo}
                    replyName={replyTo && (myIds.current.has(replyTo.from) ? "自己" : users[replyTo.from] || replyTo.n)}
                    onCancelReply={() => setReplyTo(null)} onSend={sendText} onFiles={sendFiles}
                    onTyping={() => sendRaw({ t: "typing" })}
                    typing={typingNames} />

                {dragging && <div className="dropzone">放開就會傳送</div>}
            </main>

            <dialog ref={viewer} className="viewer" onClose={() => setViewing(null)}
                onClick={() => viewer.current.close()}>
                {viewing && <img src={viewing} alt="" />}
            </dialog>
        </div>
    );
}

function MessageList({ list, status, myIds, children }) {
    const ref = useRef(null);
    const atBottom = useRef(true);
    const [below, setBelow] = useState(false);

    useLayoutEffect(() => {
        const el = ref.current;
        const last = list[list.length - 1];
        if (atBottom.current || (last && myIds.has(last.from))) {
            el.scrollTop = el.scrollHeight;
            setBelow(false);
        } else if (last) {
            setBelow(true);
        }
    }, [list, myIds]);

    const onScroll = () => {
        const el = ref.current;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (atBottom.current) setBelow(false);
    };

    return (
        <div className="messages" ref={ref} onScroll={onScroll} aria-live="polite" aria-busy={status !== "online"}>
            <div className="stream">{children}</div>
            {below && (
                <button className="new-below" onClick={() => ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" })}>
                    <Icon name="down" size={14} />有新訊息
                </button>
            )}
        </div>
    );
}

function Composer({ disabled, replyTo, replyName, onCancelReply, onSend, onFiles, onTyping, typing }) {
    const [text, setText] = useState("");
    const ta = useRef(null);
    const fileInput = useRef(null);
    const lastTyping = useRef(0);

    useLayoutEffect(() => {
        const el = ta.current;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 180) + "px";
    }, [text]);

    useEffect(() => { if (replyTo) ta.current.focus(); }, [replyTo]);

    const submit = () => {
        const t = text.trim();
        if (!t || disabled) return;
        onSend(t);
        setText("");
    };

    return (
        <div className="composer">
            <div className="composer-inner">
                <div className="typing" aria-live="polite">
                    {typing.length > 0 && `${typing.slice(0, 3).join("、")} 正在輸入…`}
                </div>
                {replyTo && (
                    <div className="replying">
                        <Icon name="reply" size={14} />
                        <span>回覆 <b>{replyName}</b>：{snippet(replyTo)}</span>
                        <button className="icon-btn sm" onClick={onCancelReply} aria-label="取消回覆"><Icon name="x" size={14} /></button>
                    </div>
                )}
                <div className="composer-row">
                    <button className="icon-btn" onClick={() => fileInput.current.click()} disabled={disabled}
                        aria-label="傳送圖片或檔案" title="傳送圖片或檔案">
                        <Icon name="clip" />
                    </button>
                    <input ref={fileInput} type="file" multiple hidden
                        onChange={e => { onFiles([...e.target.files]); e.target.value = ""; }} />
                    <textarea ref={ta} rows={1} maxLength={MAX_TEXT} value={text} aria-label="訊息"
                        placeholder={disabled ? "連線中…" : "輸入訊息"}
                        onChange={e => {
                            setText(e.target.value);
                            const now = Date.now();
                            if (now - lastTyping.current > 2000) { lastTyping.current = now; onTyping(); }
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
                            if (e.key === "Escape" && replyTo) onCancelReply();
                        }}
                        onPaste={e => {
                            const files = [...e.clipboardData.files];
                            if (files.length && !disabled) { e.preventDefault(); onFiles(files); }
                        }} />
                    <button className="send" onClick={submit} disabled={disabled || !text.trim()} aria-label="送出">
                        <Icon name="send" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function NameEditor({ name, onRename }) {
    const [editing, setEditing] = useState(false);
    const [v, setV] = useState(name);
    if (editing) {
        const done = save => { if (save) onRename(v); setEditing(false); };
        return (
            <form className="name-edit" onSubmit={e => { e.preventDefault(); done(true); }}>
                <input className="field" autoFocus maxLength={24} value={v} aria-label="你的暱稱"
                    onChange={e => setV(e.target.value)} onBlur={() => done(true)}
                    onKeyDown={e => e.key === "Escape" && done(false)} />
            </form>
        );
    }
    return (
        <button className="name-btn" onClick={() => { setV(name); setEditing(true); }} title="修改暱稱">
            <span className="name-label">你的暱稱</span>
            <span className="name-value">{name}</span>
            <Icon name="pencil" size={14} />
        </button>
    );
}

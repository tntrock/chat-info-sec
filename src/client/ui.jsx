import { useState } from "react";
import { applyTheme, hueFor, store } from "./util.js";

const PATHS = {
    lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
    send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z",
    clip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
    reply: "M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4",
    copy: "M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
    bellOff: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0M3 3l18 18",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
    moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
    leave: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    x: "M18 6 6 18M6 6l12 12",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
    pencil: "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
    down: "M12 5v14M19 12l-7 7-7-7",
    check: "M20 6 9 17l-5-5",
};

export function Icon({ name, size = 18 }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    );
}

export function ThemeToggle() {
    const [theme, setTheme] = useState(document.documentElement.dataset.theme);
    const flip = () => {
        const t = theme === "dark" ? "light" : "dark";
        applyTheme(t);
        store.set("theme", t);
        setTheme(t);
    };
    return (
        <button className="icon-btn" onClick={flip} aria-label={theme === "dark" ? "切換成淺色" : "切換成深色"}
            title={theme === "dark" ? "切換成淺色" : "切換成深色"}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
    );
}

export function Avatar({ id, name = "?" }) {
    return <span className="avatar" style={{ "--h": hueFor(id) }} aria-hidden="true">{[...name][0]}</span>;
}

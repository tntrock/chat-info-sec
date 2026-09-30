import { createRoot } from "react-dom/client";
import Lobby from "./Lobby.jsx";
import Chat from "./Chat.jsx";
import { ROOM_RE, applyTheme, initialTheme } from "./util.js";
import "./styles.css";

applyTheme(initialTheme());
const room = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
createRoot(document.getElementById("root")).render(ROOM_RE.test(room) ? <Chat room={room} /> : <Lobby />);

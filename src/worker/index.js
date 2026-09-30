export { ChatRoom } from "./chatroom.js";

const ROOM_RE = /^[A-Z0-9]{8,12}$/;

export default {
    async fetch(request, env) {
        const m = new URL(request.url).pathname.match(/^\/r\/([^/]*)$/);
        if (!m) return new Response("not found", { status: 404 });
        if (!ROOM_RE.test(m[1])) return new Response("invalid room code", { status: 400 });
        return env.CHATROOM.get(env.CHATROOM.idFromName(m[1])).fetch(request);
    },
};

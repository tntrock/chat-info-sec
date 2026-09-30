# chat.info-sec.vip

端對端加密的匿名聊天室，跑在 Cloudflare Workers + Durable Objects。

- **E2EE**：訊息、圖片、暱稱、P2P 信令都在瀏覽器以 AES-256-GCM 加密。金鑰由房間密碼（或無密碼房的邀請連結 `#` 後隨機金鑰）經 PBKDF2 推導，伺服器只拿到驗證 token 的雜湊與密文。
- **離開即焚**：最後一人離開時，Durable Object 清空所有儲存。
- **功能**：Markdown / 程式碼高亮、回覆、表情反應、圖片內嵌（≤350KB）、大檔案 WebRTC 點對點、桌面通知、深淺色主題。

## 開發

```sh
npm install
npm run dev      # Vite + 本機 Workers runtime（含 Durable Object）
npm test         # Worker / 加密測試
npm run deploy   # build 後 wrangler deploy
```

## 部署（Workers Builds）

Cloudflare Dashboard → Workers & Pages → `chat-info-sec` → Settings → Builds → Connect 到此 repo：

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

之後 push 到 `main` 就會自動部署。

import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
    test: {
        projects: [
            // Worker 與不碰 DOM 的前端模組：跑在真的 Workers runtime
            {
                plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
                test: { name: "workers", include: ["test/*.spec.js"] },
            },
            // 需要 DOM 的前端模組（DOMPurify 等）
            { test: { name: "dom", environment: "jsdom", include: ["test/dom/*.spec.js"] } },
        ],
        coverage: {
            provider: "istanbul",
            reporter: ["text-summary", "lcov"],
            // React 元件與 p2p（WebRTC）需要真正的瀏覽器
            include: ["src/worker/**", "src/client/*.js"],
            exclude: ["src/client/p2p.js"],
            thresholds: { lines: 90, statements: 90, branches: 85, functions: 90 },
        },
    },
});

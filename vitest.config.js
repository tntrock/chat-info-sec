import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
    plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
    test: {
        coverage: {
            provider: "istanbul",
            reporter: ["text-summary", "lcov"],
            // React 元件、markdown（DOMPurify）、p2p（WebRTC）需要真正的瀏覽器，Workers 測試環境跑不了
            include: ["src/worker/**", "src/client/*.js"],
            exclude: ["src/client/markdown.js", "src/client/p2p.js"],
            thresholds: { lines: 90, statements: 90, branches: 85, functions: 90 },
        },
    },
});

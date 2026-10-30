import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/client/markdown.js";

const dom = html => Object.assign(document.createElement("div"), { innerHTML: html });

describe("renderMarkdown", () => {
    it("renders gfm with line breaks", () => {
        const html = renderMarkdown("**粗體** ~~刪除~~\n第二行");
        expect(html).toContain("<strong>粗體</strong>");
        expect(html).toContain("<del>刪除</del>");
        expect(html).toContain("<br>");
    });

    it("highlights fenced code by language and by guess", () => {
        const known = dom(renderMarkdown("```js\nconst a = 1;\n```"));
        expect(known.querySelector("pre code.hljs .hljs-keyword")?.textContent).toBe("const");
        const guessed = dom(renderMarkdown("```\n<div class=\"x\"></div>\n```"));
        expect(guessed.querySelector("pre code.hljs")).not.toBe(null);
        const unknown = dom(renderMarkdown("```nosuchlang\nplain\n```"));
        expect(unknown.querySelector("pre code.hljs").textContent).toContain("plain");
    });

    it("opens links in a new tab without opener", () => {
        const a = dom(renderMarkdown("[x](https://example.com)")).querySelector("a");
        expect(a.getAttribute("href")).toBe("https://example.com");
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it.each([
        ["script tag", "<script>alert(1)</script>"],
        ["event handler", '<b onclick="alert(1)">x</b>'],
        ["javascript: link", "[x](javascript:alert(1))"],
        ["javascript: html link", '<a href="javascript:alert(1)">x</a>'],
        ["svg onload", '<svg onload="alert(1)"></svg>'],
        ["iframe", '<iframe src="https://evil.test"></iframe>'],
        ["form", '<form action="https://evil.test"><button>go</button></form>'],
    ])("strips XSS: %s", (_, input) => {
        const html = renderMarkdown(input);
        expect(html).not.toMatch(/<script|onclick|onload|javascript:|<svg|<iframe|<form|<button/i);
    });

    it.each([
        ["markdown image", "![t](https://tracker.test/p.gif)"],
        ["html img", '<img src="https://tracker.test/p.gif">'],
        ["picture/source", '<picture><source srcset="https://tracker.test/a"></picture>'],
        ["video", '<video src="https://tracker.test/v.mp4"></video>'],
        ["audio", '<audio src="https://tracker.test/a.mp3"></audio>'],
        ["stylesheet link", '<link rel="stylesheet" href="https://tracker.test/s.css">'],
        ["inline style url", '<p style="background:url(https://tracker.test/x)">x</p>'],
        ["style tag", "<style>p{background:url(https://tracker.test/x)}</style>"],
    ])("blocks external resource loads: %s", (_, input) => {
        expect(renderMarkdown(input)).not.toContain("tracker.test");
    });

    it("drops id attributes (no DOM clobbering)", () => {
        expect(renderMarkdown('<p id="me">x</p>')).not.toContain("id=");
    });
});

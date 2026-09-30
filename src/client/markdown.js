import { Marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

const md = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
        code({ text, lang }) {
            const html = lang && hljs.getLanguage(lang)
                ? hljs.highlight(text, { language: lang }).value
                : hljs.highlightAuto(text).value;
            return `<pre><code class="hljs">${html}</code></pre>`;
        },
    },
});

DOMPurify.addHook("afterSanitizeAttributes", node => {
    if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

// 禁止外部圖片等資源：否則別人可以貼一張追蹤圖，拿到所有人的 IP
const FORBID_TAGS = ["img", "picture", "video", "audio", "source", "iframe", "object", "embed", "svg", "math", "style", "form", "input", "button", "textarea", "select", "link", "meta"];

export const renderMarkdown = text =>
    DOMPurify.sanitize(md.parse(text), { FORBID_TAGS, FORBID_ATTR: ["style", "id"], ADD_ATTR: ["target"] });

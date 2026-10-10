import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPages, DOC_PAGES, githubSlug, markdownToHtml, parsePagesArgs, rewriteHref, titleFromMarkdown } from "../../scripts/pages.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const RETIRED = /github\.com\/shotah\/(ai-gantry|gantry-pendant|gantry-cab|gantry-helm|gantree)\b/;

describe("pages helpers", () => {
  it("args", () => {
    expect(parsePagesArgs([])).toEqual({ outDir: "dist/pages", help: false });
    expect(parsePagesArgs(["--out=/tmp/x"]).outDir).toBe("/tmp/x");
    expect(parsePagesArgs(["-h"]).help).toBe(true);
    expect(() => parsePagesArgs(["--nope"])).toThrow(/unknown arg/);
  });

  it("slug + title", () => {
    expect(githubSlug("Risk register")).toBe("risk-register");
    expect(githubSlug("The door — choices!")).toBe("the-door-choices");
    expect(titleFromMarkdown("# Security — risks and choices\n\nbody")).toBe("Security — risks and choices");
    expect(titleFromMarkdown("no heading")).toBe("gantree");
  });

  it("rewrites doc links to stay on the site or in this repo", () => {
    expect(rewriteHref("access.md#roles")).toBe("access.html#roles");
    expect(rewriteHref("../README.md")).toBe("../index.html");
    expect(rewriteHref("../SECURITY.md")).toBe("https://github.com/shotah/gantree2/blob/main/SECURITY.md");
    expect(rewriteHref("../lib/door/gate.ts")).toBe("https://github.com/shotah/gantree2/blob/main/lib/door/gate.ts");
    expect(rewriteHref("../assets/banner.png")).toBe("../assets/banner.png");
    expect(rewriteHref("https://x.test/a")).toBe("https://x.test/a");
    expect(rewriteHref("#here")).toBe("#here");
    expect(rewriteHref("")).toBe("");
  });

  it("renders headings with ids and mermaid as a client block", () => {
    const html = markdownToHtml("## Risk register\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n```sh\nnpm test\n```");
    expect(html).toContain('<h2 id="risk-register">');
    expect(html).toContain('<pre class="mermaid">flowchart LR');
    expect(html).toContain('<code class="language-sh">npm test');
  });
});

describe("buildPages", () => {
  const out = mkdtempSync(join(tmpdir(), "pages-"));
  const built = buildPages(ROOT, out);

  it("writes home, 404, docs, catch page, privacy, assets", () => {
    for (const f of ["index.html", "404.html", "style.css", ".nojekyll", "oauth-catch/index.html", "privacy/index.html", "assets/logo.svg", "assets/banner.png"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    for (const must of ["install.md", "access.md", "architecture.md", "security.md", "custom-mcp.md", "mcp-naming.md", "eval_setup.md"]) {
      expect(built, must).toContain(must);
      expect(existsSync(join(out, "docs", must.replace(/\.md$/, ".html")))).toBe(true);
    }
    expect(readdirSync(join(out, "docs")).length).toBe(built.length);
    expect(DOC_PAGES.length).toBeGreaterThanOrEqual(built.length);
  });

  it("architecture page loads mermaid; install page does not", () => {
    expect(readFileSync(join(out, "docs/architecture.html"), "utf8")).toContain("mermaid.initialize");
    expect(readFileSync(join(out, "docs/install.html"), "utf8")).not.toContain("mermaid.initialize");
  });

  it("standalone: no page links to a retired repo", () => {
    const files = ["index.html", "404.html", "oauth-catch/index.html", "privacy/index.html", ...readdirSync(join(out, "docs")).map((f) => `docs/${f}`)];
    for (const f of files) {
      expect(readFileSync(join(out, f), "utf8"), f).not.toMatch(RETIRED);
    }
  });

  it("catch page is the registered redirect and stores nothing", () => {
    const html = readFileSync(join(out, "oauth-catch/index.html"), "utf8");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain("/auth &lt;server&gt; &lt;code&gt;");
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|localStorage/);
    expect(readFileSync(join(out, "privacy/index.html"), "utf8")).toContain("shotah.github.io/gantree2/oauth-catch/");
  });
});

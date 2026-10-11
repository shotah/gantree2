#!/usr/bin/env node
/**
 * Static GitHub Pages tree: github.bldhosting.com (custom domain on gh-pages)
 *
 *   npm run pages                      → dist/pages
 *   npm run pages -- --out=/tmp/pages
 *
 * index.html + 404.html from site/home.html, docs/*.html from docs/*.md,
 * oauth-catch/ and privacy/ copied verbatim, assets/ copied. This repo
 * stands alone: a docs link that would leave it is left as text, never
 * rewritten to another repo.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

export const PAGES_ORIGIN = "https://github.bldhosting.com";
export const REPO = "https://github.com/shotah/gantree2";
export const APPS_REPO = "https://github.com/shotah/gantree2-apps";

/** Order is the nav order. Missing files are skipped with a note so the site
 *  builds while docs are still landing; the test pins the ones that must exist. */
export const DOC_PAGES = [
  { file: "install.md", nav: "Install" },
  { file: "access.md", nav: "Access" },
  { file: "architecture.md", nav: "Architecture" },
  { file: "security.md", nav: "Security" },
  { file: "auth.md", nav: "Accounts" },
  { file: "mcp.md", nav: "MCP" },
  { file: "custom-mcp.md", nav: "Custom MCP" },
  { file: "mcp-naming.md", nav: "Naming" },
  { file: "eval_setup.md", nav: "Evals" },
];

export function parsePagesArgs(argv) {
  const out = { outDir: "dist/pages", help: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a.startsWith("--out=")) {
      out.outDir = a.slice("--out=".length);
    } else {
      throw new Error(`unknown arg ${a}`);
    }
  }
  return out;
}

export function githubSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function titleFromMarkdown(md) {
  const m = String(md).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "gantree";
}

function splitHash(href) {
  const i = href.indexOf("#");
  if (i === -1) {
    return { path: href, hash: "" };
  }
  return { path: href.slice(0, i), hash: href.slice(i) };
}

/** Rewrite hrefs inside docs/*.md so they work under /docs/ on Pages. */
export function rewriteHref(href) {
  if (!href) {
    return href;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("?")) {
    return href;
  }
  const { path, hash } = splitHash(href);
  if (path === "../README.md" || path === "README.md") {
    return `../index.html${hash}`;
  }
  if (path === "../SECURITY.md" || path === "../CONTRIBUTING.md") {
    return `${REPO}/blob/main/${path.slice(3)}${hash}`;
  }
  if (path.endsWith(".md") && !path.includes("/")) {
    return `${path.slice(0, -3)}.html${hash}`;
  }
  if (path.startsWith("../assets/")) {
    return href;
  }
  if (path.startsWith("../")) {
    // Source files outside docs (lib/, .github/): point at GitHub.
    return `${REPO}/blob/main/${path.slice(3)}${hash}`;
  }
  return href;
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function markdownToHtml(md) {
  const marked = new Marked();
  marked.use({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const plain = html.replace(/<[^>]+>/g, "");
        return `<h${depth} id="${escapeAttr(githubSlug(plain))}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const next = rewriteHref(href);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<a href="${escapeAttr(next)}"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }) {
        const next = rewriteHref(href);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<img src="${escapeAttr(next)}" alt="${escapeAttr(text)}"${titleAttr}>`;
      },
      code({ text, lang }) {
        // Mermaid blocks render client-side; everything else is a plain <pre>.
        if (lang === "mermaid") {
          return `<pre class="mermaid">${escapeAttr(text)}</pre>\n`;
        }
        const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
        return `<pre><code${cls}>${escapeAttr(text)}</code></pre>\n`;
      },
    },
  });
  return marked.parse(md, { async: false });
}

function navHtml(root, current, pages) {
  const items = [
    { href: `${root}index.html`, label: "Home", id: "home" },
    ...pages.map((p) => ({
      href: `${root}docs/${p.file.replace(/\.md$/, ".html")}`,
      label: p.nav,
      id: p.file,
    })),
    { href: REPO, label: "GitHub", id: "github" },
  ];
  return items
    .map((item) => {
      const cur = item.id === current ? ` aria-current="page"` : "";
      return `<a href="${escapeAttr(item.href)}"${cur}>${item.label}</a>`;
    })
    .join("\n        ");
}

const MERMAID = `<script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, theme: "dark" });
  </script>`;

function layout({ title, description, canonical, depth, current, body, bodyClass = "", pages, mermaid = false }) {
  const root = depth === 0 ? "" : "../";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeAttr(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta name="theme-color" content="#0e1316">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${PAGES_ORIGIN}/assets/banner.png">
  <link rel="icon" href="${root}assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
  <link rel="stylesheet" href="${root}style.css">
</head>
<body class="${escapeAttr(bodyClass)}">
  <a class="skip" href="#content">Skip to content</a>
  <header class="top">
    <a class="brand" href="${root}index.html">
      <img src="${root}assets/logo.svg" width="28" height="28" alt="">
      gantree
    </a>
    <nav class="nav" aria-label="Site">
        ${navHtml(root, current, pages)}
    </nav>
  </header>
  <main id="content" class="wrap">
    ${body}
  </main>
  <footer class="foot">
    <div class="wrap">
      <span>MIT</span>
      <span>
        <a href="${root}privacy/">privacy</a>
        · <a href="${root}oauth-catch/">oauth code</a>
        · <a href="${APPS_REPO}">apps</a>
      </span>
      <span><a href="${REPO}">github.com/shotah/gantree2</a></span>
    </div>
  </footer>
  ${mermaid ? MERMAID : ""}
</body>
</html>
`;
}

const HOME_DESCRIPTION
  = "gantree is a personal AI agent you run on Cloudflare or a box at home, with a chat app for the browser, Android, and iPhone. No open ports.";

export function buildPages(rootDir, outDir, log = () => {}) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, ".nojekyll"), "");
  cpSync(join(rootDir, "site", "style.css"), join(outDir, "style.css"));
  cpSync(join(rootDir, "assets"), join(outDir, "assets"), { recursive: true });
  for (const dir of ["oauth-catch", "privacy"]) {
    cpSync(join(rootDir, "site", dir), join(outDir, dir), { recursive: true });
  }

  const pages = DOC_PAGES.filter((p) => {
    const ok = existsSync(join(rootDir, "docs", p.file));
    if (!ok) {
      log(`skip docs/${p.file} (not yet)`);
    }
    return ok;
  });

  const homeBody = readFileSync(join(rootDir, "site", "home.html"), "utf8");
  writeFileSync(join(outDir, "index.html"), layout({
    title: "gantree — your agent, your box",
    description: HOME_DESCRIPTION,
    canonical: `${PAGES_ORIGIN}/`,
    depth: 0,
    current: "home",
    body: homeBody,
    bodyClass: "home",
    pages,
  }));

  writeFileSync(join(outDir, "404.html"), layout({
    title: "Not here — gantree",
    description: HOME_DESCRIPTION,
    canonical: `${PAGES_ORIGIN}/404.html`,
    depth: 0,
    current: "",
    body: `<div class="lost">
      <p class="kicker">404</p>
      <h1>That page is not here.</h1>
      <p><a href="index.html">Back to the start</a></p>
    </div>`,
    pages,
  }));

  mkdirSync(join(outDir, "docs"), { recursive: true });
  for (const page of pages) {
    const md = readFileSync(join(rootDir, "docs", page.file), "utf8");
    const title = titleFromMarkdown(md);
    const slug = page.file.replace(/\.md$/, ".html");
    writeFileSync(join(outDir, "docs", slug), layout({
      title: `${title} — gantree`,
      description: title,
      canonical: `${PAGES_ORIGIN}/docs/${slug}`,
      depth: 1,
      current: page.file,
      body: `<article class="prose">${markdownToHtml(md)}</article>`,
      pages,
      mermaid: md.includes("```mermaid"),
    }));
  }
  return pages.map((p) => p.file);
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isMain()) {
  const args = parsePagesArgs(process.argv.slice(2));
  if (args.help) {
    console.log("npm run pages [-- --out=dist/pages]");
    process.exit(0);
  }
  const root = resolve(import.meta.dirname, "..");
  const outDir = resolve(root, args.outDir);
  buildPages(root, outDir, (m) => console.log(m));
  const docs = readdirSync(join(outDir, "docs")).length;
  console.log(`wrote ${outDir} (${docs} doc pages)`);
}

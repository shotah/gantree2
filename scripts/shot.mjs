#!/usr/bin/env node
/**
 * Headless Chrome shots via CDP (no puppeteer).
 *
 *   npm run shot
 *   npm run shot -- http://127.0.0.1:3000 login agents
 *   CHROME_BIN=/path/to/chrome npm run shot
 *
 * Writes assets/docs/<name>.png. Desktop shots are 1440×900. Phone shots
 * (/chat/kit, /chat) are 390×844 at deviceScaleFactor 3.
 *
 * The server is `npm run dev:shot` (CLOUDFLARE_ENV=shot → .dev.vars.shot,
 * written by `npm run seed`), so the signed-in user is always the
 * placeholder dev@example.com, never a real account. Every shot wears
 * a mood theme (Neon; GANTREE_SHOT_THEME overrides).
 *
 * /login is taken signed out: a fresh Chrome profile, cookies cleared.
 * The other pages are whoever the dev server signs in (GANTREE_DEV_USER
 * on loopback). /chat is the picker. A member with several agents is
 * seeded as sam@example.com; the loopback dev user wins over that
 * cookie, so the picker shot is the dev user unless you restart the
 * server with GANTREE_DEV_USER unset in .dev.vars.shot and
 * GANTREE_SHOT_AS_MEMBER=1.
 * The member cookie, when seed could mint one, is in the OS temp dir
 * as gantree2-member-cookie.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEMBER_COOKIE_NAME,
  REPO_ROOT,
  SESSION_COOKIE,
  SHOTS,
  chromeBin,
  memberCookieFile,
  parseShotArgs,
  shotFile,
  shotTheme,
  themeSeedScript,
  viewportFor,
} from "./shots.ts";

function isMain() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function sleep(ms) {
  return new Promise((resolveP) => {
    setTimeout(resolveP, ms);
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveP, reject) => {
      this.pending.set(id, { resolve: resolveP, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evalJson(cdp, expression) {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result?.value;
}

async function waitCdp(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error("chrome CDP did not start");
}

async function shoot(base, names) {
  const chrome = chromeBin();
  if (!existsSync(chrome)) {
    throw new Error(`chrome not found at ${chrome} (set CHROME_BIN)`);
  }
  const port = Number(process.env.CDP_PORT || 9244);
  const profile = join(tmpdir(), `gantree2-chrome-shot-${port}`);
  const outDir = join(REPO_ROOT, "assets", "docs");
  mkdirSync(profile, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitCdp(port);
    const listed = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
    let page = Array.isArray(listed)
      ? listed.find((target) => target.type === "page" && target.webSocketDebuggerUrl && !String(target.url ?? "").includes("background"))
      : null;
    if (!page) {
      const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      page = await created.json();
    }
    if (!page?.webSocketDebuggerUrl) {
      throw new Error("no page target");
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveP, reject) => {
      ws.addEventListener("open", resolveP);
      ws.addEventListener("error", () => reject(new Error("cdp ws")));
    });
    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    async function goto(url) {
      await cdp.send("Page.navigate", { url });
      for (let i = 0; i < 40; i++) {
        const ready = await evalJson(cdp, "document.readyState");
        if (ready === "complete") {
          break;
        }
        await sleep(250);
      }
      await sleep(500);
    }

    async function waitText(text, ms = 25000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const ok = await evalJson(cdp, `document.body?.innerText?.includes(${JSON.stringify(text)})`);
        if (ok) {
          return;
        }
        await sleep(250);
      }
      const body = await evalJson(cdp, "document.body?.innerText?.slice(0, 800)");
      throw new Error(`timeout waiting for ${text} body=${body}`);
    }

    let themeScript = null;
    for (const name of names) {
      const spec = SHOTS[name];
      const view = viewportFor(Boolean(spec.phone));
      await cdp.send("Emulation.setDeviceMetricsOverride", view);
      if (themeScript) {
        await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: themeScript });
      }
      themeScript = (await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: themeSeedScript(shotTheme(spec, process.env)),
      })).identifier;
      if (spec.signedOut) {
        await cdp.send("Network.clearBrowserCookies");
      }
      if (spec.member && process.env.GANTREE_SHOT_AS_MEMBER === "1") {
        const file = memberCookieFile();
        if (!existsSync(file)) {
          throw new Error(`member cookie missing (${MEMBER_COOKIE_NAME}); run npm run seed first`);
        }
        await cdp.send("Network.clearBrowserCookies");
        await cdp.send("Network.setCookie", {
          name: SESSION_COOKIE,
          value: readFileSync(file, "utf8").trim(),
          url: base,
          httpOnly: true,
          sameSite: "Lax",
        });
      } else if (spec.member) {
        console.log("chat: dev user (set GANTREE_SHOT_AS_MEMBER=1 with GANTREE_DEV_USER unset for the member picker)");
      }
      await goto(base + spec.path);
      await waitText(spec.text);
      if (spec.open) {
        await evalJson(cdp, `(() => {
          for (const name of ${JSON.stringify(spec.open)}) {
            const button = document.querySelector('button[aria-label="' + name + '"]');
            if (button && button.getAttribute("aria-expanded") === "false") button.click();
          }
          return true;
        })()`);
        await sleep(600);
      }
      if (spec.waitMs) {
        await sleep(spec.waitMs);
      }
      await evalJson(cdp, "window.scrollTo(0,0)");
      await sleep(200);
      const png = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: Boolean(spec.full),
      });
      const file = shotFile(name);
      writeFileSync(join(outDir, file), Buffer.from(png.data, "base64"));
      console.log("wrote", file);
    }
    ws.close();
  } finally {
    child.kill("SIGTERM");
  }
}

if (isMain()) {
  const args = parseShotArgs(process.argv.slice(2));
  shoot(args.base, args.names).catch((err) => {
    console.error(err instanceof Error ? err.message : "shot failed");
    process.exit(1);
  });
}

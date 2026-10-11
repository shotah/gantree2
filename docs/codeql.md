# CodeQL

`.github/workflows/codeql.yml` runs `javascript-typescript` with the
`security-extended` suite (the default security queries plus the
lower-severity ones). The list below is that suite on query pack
`codeql/javascript-queries` 2.4.7, CLI 2.27.2, which is the CLI the
main-branch run used. The code-scanning API is not readable from this
checkout (the GitHub session here is pull-only and has no
`security_events` scope), so these are the results of a local rerun,
not the alert numbers on GitHub.

Fifteen results, six rules.

| Rule | Count | Level | Security severity |
| --- | --- | --- | --- |
| `js/bad-code-sanitization` | 6 | error | 6.1 |
| `js/incomplete-url-substring-sanitization` | 4 | warning | 7.8 |
| `js/file-access-to-http` | 2 | warning | 6.5 |
| `js/incomplete-multi-character-sanitization` | 1 | warning | 7.8 |
| `js/identity-replacement` | 1 | warning | 5.0 |
| `js/regex/missing-regexp-anchor` | 1 | warning | 7.8 |

`eslint-plugin-no-unsanitized` is not installed. Nothing in this run
is a DOM sink (`js/xss` and the other HTML-sink queries were quiet).
`@microsoft/eslint-plugin-sdl` is not installed. None of its rules
(`no-inner-html`, `no-document-write`, `no-insecure-url`, …) is the
finding above.

## What ESLint enforces

`eslint-plugin-security` and `eslint-plugin-regexp` are dev
dependencies. These rules are errors:

| ESLint rule | CodeQL family |
| --- | --- |
| `no-eval` | `js/bad-code-sanitization` (CWE-94). `eval` of a string. |
| `no-new-func` | Same family. `new Function` builds code from a string. |
| `security/detect-eval-with-expression` | Same family. `eval` of a non-literal. |
| `security/detect-unsafe-regex` | ReDoS sibling of the regex queries in this suite (`js/redos`, `js/polynomial-redos`). None of those fired on this run. |
| `regexp/no-super-linear-backtracking` | Same sibling. Exponential and polynomial backtracking. |
| `regexp/no-super-linear-move` | Same sibling. Quantifiers that move in quadratic time. |

The six findings themselves are not those shapes. `JSON.stringify`
inside a boot script, a host check with `includes`, a no-op
`replace`, and an unanchored `github.com` pattern have no rule in
these plugins. Those are tests, or they are deferred below.

## Tests, where a plugin cannot say it

Host checks (`js/incomplete-url-substring-sanitization`). Parse with
`URL` and compare `hostname`. `includes("docs.google.com/")` is true
for `notdocs.google.com`, and `startsWith("www.googleapis.com")` is
true for `www.googleapis.com.evil.test`.

- `brain/plugins/google/ids.ts` — `looksLikeGoogleURL` allows only
  `docs.google.com`, `drive.google.com`, and `forms.gle`.
- `brain/plugins/feeds/parse.ts` — a JSON Feed `version` counts only
  when its host is `jsonfeed.org`. A document with an `items` array
  is still a feed, which is the old fallback.
- `test/brain/plugins/google/workspace.test.ts` — the upload mock
  compares `hostname === "www.googleapis.com"`.
- Tests: `test/brain/plugins/google/ids.test.ts`,
  `test/brain/plugins/feeds/feeds.test.ts`.

Identity replace (`js/identity-replacement`). Replacing a match with
the same text does nothing. `formatFloat` had `.replace(/e\+/, "e+")`
in front of the exponent cleanup. That call is gone. `1e21` still
formats as `1e+21`. Test: `test/brain/plugins/math/math.test.ts`.

Unanchored host (`js/regex/missing-regexp-anchor`). A pattern with
`github.com` and no anchor matches `notgithub.com` and a copy of the
path in a query string. The pages test now requires the start of the
string or `http(s)://` in front of the host. Test:
`test/scripts/pages.test.ts`.

## Deferred

Another checkout owns these paths. Do not edit them from here. Each
fix below was checked against the query: the bad form still alerts,
the replacement does not.

### `js/bad-code-sanitization`

`app/lib/font.ts:48` (`FONT_BOOT`, two `JSON.stringify` calls) and
`app/lib/theme.ts:82` (`THEME_BOOT`, four). `JSON.stringify` does not
escape `<`, `>`, `/`, U+2028, or U+2029, so a value can break out of
the `<script>` the boot string is dropped into. The keys and theme
ids in the tree today have none of those characters, so escaping them
does not change the script text.

Add this next to each boot string and use it for every
`JSON.stringify` inside that template:

```ts
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (ch) => {
    if (ch === "<") return "\\u003C";
    if (ch === ">") return "\\u003E";
    if (ch === "/") return "\\u002F";
    if (ch === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}
```

`FONT_BOOT` wraps `FONT_KEY` and `FONT_IDS`. `THEME_BOOT` wraps
`themeIdList()`, `FOLLOW_THEME_PREF_KEY`, `ROOM_THEME_KEY`, and
`THEME_KEY`.

### `js/incomplete-multi-character-sanitization`

`scripts/pages.mjs:114`, in the heading renderer:

```js
const plain = html.replace(/<[^>]+>/g, "");
```

One pass of a multi-character pattern can leave `<script` in the
slug text (`<scr<script>ipt>` style input). Repeat until the string
stops changing. A one-shot replace stays flagged; this loop does not:

```js
function plainHeading(html) {
  let prev = "";
  let cur = html;
  do {
    prev = cur;
    cur = cur.replace(/<[^>]*>/g, "");
  } while (cur !== prev);
  return cur;
}
```

Call `plainHeading(html)` instead of the one-shot replace. `githubSlug`
and `escapeAttr` stay as they are.

### `js/file-access-to-http`

Both are local tools. The query still follows the bytes from
`readFileSync` into `fetch` / the CDP WebSocket. A check in a helper
that *returns* the string does not clear it. An inline
`/pattern/.test(value)` that throws, in the same function as the
send, does, when the pattern is a restricted class (a `[\s\S]` or
negated control-character class does not).

`scripts/shot.mjs:90` (the read is at line 211). The member session
cookie is `readFileSync(memberCookieFile(), "utf8").trim()` and sent
as `Network.setCookie` `value` through `Cdp.send` → `ws.send`. The
socket is the local Chrome debugging port. `sealSession` writes a
compact JWE (base64url segments, dots, no padding). In `shoot`, after
the read and before `cdp.send`:

```js
const value = readFileSync(file, "utf8").trim();
if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}$/.test(value)) {
  throw new Error("member cookie is not a compact JWE");
}
await cdp.send("Network.setCookie", {
  name: SESSION_COOKIE,
  value,
  url: base,
  httpOnly: true,
  sameSite: "Lax",
});
```

Keep the test in `shoot`. Moving it to a function in `scripts/shots.ts`
leaves the alert.

`scripts/seed.ts:438`, in `call`. `readFileSync` of `.dev.vars` /
`.dev.vars.shot` (line 650, `readIf`) becomes the dev email, then the
persona, then `JSON.stringify(req.body)` on the `fetch` to the local
seed base. Every seed body is a JSON object, and `JSON.stringify`
emits no raw control characters, including the unicode in
`PERSONA_TEMPLATE`. In `call`, bind the payload and test it there:

```ts
const payload = req.body === undefined ? undefined : JSON.stringify(req.body);
if (typeof payload === "string" && !/^[\u0020-\uFFFF]*$/.test(payload)) {
  throw new Error("seed body is not JSON text");
}
const res = await fetch(new URL(req.path, base), {
  method: req.method,
  headers,
  body: payload,
});
```

Do not rewrite that test as `/^[^\u0000-\u001F]*$/`. That form still
alerts. A GET with no body leaves `payload` undefined and skips the
test.

# CodeQL

`.github/workflows/codeql.yml` runs `javascript-typescript` with the
`security-extended` suite (the default security queries plus the
lower-severity ones). Query pack `codeql/javascript-queries` 2.4.7,
CLI 2.27.2, which is the CLI the main-branch run used. The
code-scanning API is not readable from this checkout (the GitHub
session here is pull-only and has no `security_events` scope), so the
counts are a local rerun, not the alert numbers on GitHub.

The first local run reported fifteen alerts. The rerun after the
fixes in this tree reports none.

| Rule | First run | Now | Level | Security severity |
| --- | --- | --- | --- | --- |
| `js/bad-code-sanitization` | 6 | 0 | error | 6.1 |
| `js/incomplete-url-substring-sanitization` | 4 | 0 | warning | 7.8 |
| `js/file-access-to-http` | 2 | 0 | warning | 6.5 |
| `js/incomplete-multi-character-sanitization` | 1 | 0 | warning | 7.8 |
| `js/identity-replacement` | 1 | 0 | warning | 5.0 |
| `js/regex/missing-regexp-anchor` | 1 | 0 | warning | 7.8 |

`eslint-plugin-no-unsanitized` is not installed. Nothing in the first
run was a DOM sink (`js/xss` and the other HTML-sink queries were
quiet). `@microsoft/eslint-plugin-sdl` is not installed. None of its
rules (`no-inner-html`, `no-document-write`, `no-insecure-url`, …)
matched a finding.

## What ESLint enforces

`eslint-plugin-security` and `eslint-plugin-regexp` are dev
dependencies. These rules are errors:

| ESLint rule | CodeQL family |
| --- | --- |
| `no-eval` | `js/bad-code-sanitization` (CWE-94). `eval` of a string. |
| `no-new-func` | Same family. `new Function` builds code from a string. |
| `security/detect-eval-with-expression` | Same family. `eval` of a non-literal. |
| `security/detect-unsafe-regex` | ReDoS sibling of the regex queries in this suite (`js/redos`, `js/polynomial-redos`). None of those fired. `safe-regex` rejects a quantifier nested inside a quantifier. |
| `regexp/no-super-linear-backtracking` | Same sibling. Exponential and polynomial backtracking. |

`regexp/no-super-linear-move` is the quadratic sibling (a `+` that can be
pushed along by a rejecting suffix). It is not enabled. It reports
`\n+`, `\d+`, and `0+` throughout the tree and has no fix, which is
not what `js/polynomial-redos` matches.

`npm run lint` is clean with the rules above.

## Tests, where a plugin cannot say it

Host checks (`js/incomplete-url-substring-sanitization`). Parse with
`URL` and compare `hostname`. `includes("docs.google.com/")` is true
for `notdocs.google.com`, and `startsWith("www.googleapis.com")` is
true for `www.googleapis.com.evil.test`.

- `harness/plugins/google/ids.ts` — `looksLikeGoogleURL` allows only
  `docs.google.com`, `drive.google.com`, and `forms.gle`.
- `harness/plugins/feeds/parse.ts` — a JSON Feed `version` counts only
  when its host is `jsonfeed.org`. A document with an `items` array
  is still a feed, which is the old fallback.
- `test/harness/plugins/google/workspace.test.ts` — the upload mock
  compares `hostname === "www.googleapis.com"`.
- Tests: `test/harness/plugins/google/ids.test.ts`,
  `test/harness/plugins/feeds/feeds.test.ts`.

Identity replace (`js/identity-replacement`). Replacing a match with
the same text does nothing. `formatFloat` had `.replace(/e\+/, "e+")`
in front of the exponent cleanup. That call is gone. `1e21` still
formats as `1e+21`. Test: `test/harness/plugins/math/math.test.ts`.

Unanchored host (`js/regex/missing-regexp-anchor`). A pattern with
`github.com` and no anchor matches `notgithub.com` and a copy of the
path in a query string. The pages test now requires the start of the
string or `http(s)://` in front of the host. Test:
`test/scripts/pages.test.ts`.

## Fixes that no plugin rule covers

`js/bad-code-sanitization`. `app/lib/font.ts` (`FONT_BOOT`) and
`app/lib/theme.ts` (`THEME_BOOT`) build a `<script>` from
`JSON.stringify`. That does not escape `<`, `>`, `/`, U+2028, or
U+2029. Each file has a `jsonForScript` that escapes those five to
`\u003C`, `\u003E`, `\u002F`, `\u2028`, and `\u2029`, and every
`JSON.stringify` inside the boot template goes through it. The keys
and theme ids in the tree have none of those characters, so the
script text does not change.

`js/incomplete-multi-character-sanitization`. `scripts/pages.mjs`
`plainHeading` repeats `replace(/<[^>]*>/g, "")` until the string
stops changing, then the heading slug is built from that. One pass
can leave `<script` behind (`<scr<script>ipt>`). `githubSlug` and
`escapeAttr` are unchanged. `let prev` is uninitialized because
assigning `""` first is a useless assignment.

`js/file-access-to-http`. Both tools are local. The query follows
`readFileSync` bytes into `fetch` or the CDP WebSocket. The guard has
to be an inline `/pattern/.test(value)` that throws, in the same
function as the send. A helper that returns the checked string does
not clear it, and neither does `/^[^\u0000-\u001F]*$/`.

`scripts/shot.mjs`, in `shoot`. The member cookie is read and sent as
`Network.setCookie` `value`. `sealSession` writes a compact JWE (five
base64url segments, dots, no padding). Before `cdp.send`:

```js
if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
  throw new Error("member cookie is not a compact JWE");
}
```

`{2,}` around a `+` is a nested quantifier, so
`security/detect-unsafe-regex` rejects it. Five segments is the
compact form jose writes, and each `+` sits next to a literal dot.

`scripts/seed.ts`, in `call`. The dev vars become the persona, then
`JSON.stringify(req.body)` on the `fetch`. The test has to dominate
that send. A check that later joins the no-body path does not: the
value `fetch` receives is still the file-derived string. The body
branch tests, then sends:

```ts
const payload = JSON.stringify(req.body);
if (!/^[\u0020-\uFFFF]*$/.test(payload)) {
  throw new Error("seed body is not JSON text");
}
res = await fetch(new URL(req.path, base), {
  method: req.method,
  headers,
  body: payload,
});
```

A GET builds the request with no body and does not run the test.
Do not rewrite the test as `/^[^\u0000-\u001F]*$/`. That form still
alerts.

## Deferred

None.

## ReDoS patterns the new rules rejected

These were not CodeQL alerts. They failed `security/detect-unsafe-regex`
or `regexp/no-super-linear-backtracking`.

- `app/lib/spend.ts` `parseSpendRate` strips commas, trims, drops one
  leading `$`, then matches `/^(\d+\.\d+|\d+)/`. A `$` inside the
  whitespace quantifiers either nests or lets two `\s*` split the
  same spaces.
- `harness/eval/expect.ts` `PRICE_RE` is `/\$\s?(\d[\d,]*\.\d+|\d[\d,]*)/g`.
- `harness/eval/fixture.ts` `RFC3339` splits the optional fraction into
  its own alternative so `\d+` is not inside `?`.
- `lib/agents/mcpToml.ts` `isServerHeader` is two alternatives, one
  with a `#` comment and one without, instead of `(?:#.*)?`.
- `scripts/pages.mjs` `titleFromMarkdown` reads `/^#([^\n]*)$/m`, then
  requires the rest to start with whitespace.

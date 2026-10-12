---
applyTo: "test/**"
---

# Tests

Vitest. The file mirrors the source path: `lib/door/gate.ts` is
`test/door/gate.test.ts`, `harness/memory/store.ts` is
`test/harness/memory/store.test.ts`. Import with `@/`.

Harness SQL in tests is `nodeSql` over an in-memory `node:sqlite`
database. The production harness reaches SQLite through `Sql`. The test
imports `node:sqlite` and passes the handle to `nodeSql`.

```ts
import { DatabaseSync } from "node:sqlite";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";

const sql = nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
```

Time is `fixedClock`. Logs are `silentLogger` or `memorySink`. A harness
package moves when the test calls `set` or `tick` on that clock.
Plugin cases share `pluginCtx` in `test/harness/plugins/helpers.ts`.

Package fixtures live beside the suite (`test/harness/aims/fixture.ts`,
`test/harness/cron/fixture.ts`, `test/harness/tools/fixture.ts`). They open
`nodeSql` the same way. Behavioral fixtures are JSON under
`harness/eval/fixtures/`. They stay there. `test/harness/eval/` checks them.

Stub `fetch`. A test does not call the network. Keys in a fixture are
placeholders (`"k"`, `"x"`).

`Buffer` comes from `node:buffer`.

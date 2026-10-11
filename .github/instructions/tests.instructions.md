---
applyTo: "test/**"
---

# Tests

Vitest. The file mirrors the source path: `lib/door/gate.ts` is
`test/door/gate.test.ts`, `brain/memory/store.ts` is
`test/brain/memory/store.test.ts`. Import with `@/`.

Brain SQL in tests is `nodeSql` over an in-memory `node:sqlite`
database. The production brain reaches SQLite through `Sql`. The test
imports `node:sqlite` and passes the handle to `nodeSql`.

```ts
import { DatabaseSync } from "node:sqlite";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";

const sql = nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
```

Time is `fixedClock`. Logs are `silentLogger` or `memorySink`. A brain
package moves when the test calls `set` or `tick` on that clock.
Plugin cases share `pluginCtx` in `test/brain/plugins/helpers.ts`.

Package fixtures live beside the suite (`test/brain/aims/fixture.ts`,
`test/brain/cron/fixture.ts`, `test/brain/tools/fixture.ts`). They open
`nodeSql` the same way. Behavioral fixtures are JSON under
`brain/eval/fixtures/`. They stay there. `test/brain/eval/` checks them.

Stub `fetch`. A test does not call the network. Keys in a fixture are
placeholders (`"k"`, `"x"`).

`Buffer` comes from `node:buffer`.

// Base OpenAPI object; patched in openapi-doc.ts
export const OPENAPI_BASE = {
  openapi: "3.1.0",
  info: {
    title: "gantree",
    // Spec cut. Not the package release; a version bump must not rewrite this.
    version: "0.2.26",
    description: "This document is the HTTP API of the Vinext Worker.\nThe harness inside the Agent Durable Object opens no listen port. A turn is a method call inside that object.\nThe Worker answers these routes. The mailbox is `GET /ws/{slug}` (WebSocket upgrade), answered in `worker/index.ts` before Vinext middleware.\nThe harness also calls `GET` and `POST` `/api/chat/avatar`, and the backdrop and theme routes, with the room bearer.\n",
  },
  servers: [
    {
      url: "https://gantree2.bldhosting.com",
    },
    {
      url: "http://127.0.0.1:3000",
    },
  ],
  tags: [
    {
      name: "health",
    },
    {
      name: "auth",
    },
    {
      name: "users",
    },
    {
      name: "platform",
    },
    {
      name: "agents",
    },
    {
      name: "tools",
    },
    {
      name: "chat",
    },
    {
      name: "mailbox",
    },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "gantree_session",
        description: "Session JWE (dir/A256GCM). Role is not in the cookie. Opened by middleware (`lib/door/gate.ts`).",
      },
      sessionBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWE",
        description: "Same session JWE as the cookie, in `Authorization`. Used by Cab and Helm. A valid cookie wins; otherwise this bearer. Not the room token.",
      },
      roomBearer: {
        type: "http",
        scheme: "bearer",
        description: "Per-agent room token (`AGENT_BEARERS` or the Agent DO bearer row). Header only. Used by the harness on chat media routes and on `GET /ws/{slug}` when `role` is `crane` or `agent`.",
      },
    },
    parameters: {
      AgentSlugPath: {
        name: "slug",
        in: "path",
        required: true,
        schema: {
          type: "string",
          pattern: "^[a-z][a-z0-9-]{0,31}$",
        },
      },
      AgentSlugQuery: {
        name: "slug",
        in: "query",
        required: true,
        schema: {
          type: "string",
          pattern: "^[a-z][a-z0-9-]{0,31}$",
        },
      },
      LogAfter: {
        name: "after",
        in: "query",
        required: false,
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      SamplesAgent: {
        name: "agent",
        in: "query",
        required: false,
        schema: {
          type: "string",
          pattern: "^[a-z][a-z0-9-]{0,31}$",
        },
      },
      SamplesSince: {
        name: "since",
        in: "query",
        required: false,
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      WsRole: {
        name: "role",
        in: "query",
        required: true,
        schema: {
          type: "string",
          enum: [
            "phone",
            "crane",
            "agent",
          ],
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: [
          "error",
        ],
        properties: {
          error: {
            type: "string",
          },
        },
      },
      Health: {
        type: "object",
        required: [
          "ok",
          "version",
          "time",
        ],
        properties: {
          ok: {
            type: "boolean",
          },
          version: {
            type: "string",
          },
          time: {
            type: "string",
            format: "date-time",
          },
        },
      },
      AuthConfig: {
        type: "object",
        required: [
          "mode",
          "google",
          "voice",
          "version",
          "dev",
        ],
        properties: {
          mode: {
            type: "string",
            enum: [
              "google",
              "spike",
            ],
          },
          google: {
            type: "boolean",
          },
          voice: {
            type: "boolean",
          },
          version: {
            type: "string",
          },
          dev: {
            type: "boolean",
          },
        },
      },
      AuthNonce: {
        type: "object",
        required: [
          "nonce",
        ],
        properties: {
          nonce: {
            type: "string",
          },
        },
      },
      AuthTokenRequest: {
        type: "object",
        required: [
          "id_token",
          "nonce",
        ],
        properties: {
          id_token: {
            type: "string",
          },
          nonce: {
            type: "string",
          },
        },
      },
      AuthTokenResponse: {
        type: "object",
        required: [
          "token",
          "sub",
          "email",
          "exp",
        ],
        properties: {
          token: {
            type: "string",
          },
          sub: {
            type: "string",
          },
          email: {
            type: "string",
            nullable: true,
          },
          exp: {
            type: "integer",
            description: "Epoch seconds.",
          },
        },
      },
      AuthTokenForbidden: {
        type: "object",
        required: [
          "error",
          "sub",
          "email",
        ],
        properties: {
          error: {
            type: "string",
            const: "not_allowed",
          },
          sub: {
            type: "string",
          },
          email: {
            type: "string",
            nullable: true,
          },
        },
      },
      Principal: {
        type: "object",
        required: [
          "sub",
          "email",
          "role",
          "agents",
          "cranes",
        ],
        properties: {
          sub: {
            type: "string",
          },
          email: {
            type: "string",
            nullable: true,
          },
          role: {
            type: "string",
            enum: [
              "admin",
              "operator",
              "member",
            ],
          },
          agents: {
            type: "array",
            items: {
              type: "string",
            },
          },
          cranes: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Alias of `agents`.",
          },
        },
      },
      UserRow: {
        type: "object",
        required: [
          "entry",
          "role",
          "agents",
          "locked",
        ],
        properties: {
          entry: {
            type: "string",
          },
          role: {
            type: "string",
            enum: [
              "admin",
              "operator",
              "member",
            ],
          },
          agents: {
            type: "array",
            items: {
              type: "string",
            },
          },
          locked: {
            type: "boolean",
          },
        },
      },
      AuditEvent: {
        type: "object",
        required: [
          "id",
          "at",
          "who",
          "action",
          "detail",
        ],
        properties: {
          id: {
            type: "integer",
          },
          at: {
            type: "integer",
            description: "ms epoch",
          },
          who: {
            type: "string",
          },
          action: {
            type: "string",
          },
          detail: {
            type: "string",
          },
        },
      },
      UsersList: {
        type: "object",
        required: [
          "users",
          "audit",
        ],
        properties: {
          users: {
            type: "array",
            items: {
              $ref: "#/components/schemas/UserRow",
            },
          },
          audit: {
            type: "array",
            items: {
              $ref: "#/components/schemas/AuditEvent",
            },
          },
        },
      },
      UserCreate: {
        type: "object",
        required: [
          "entry",
          "role",
          "agents",
        ],
        properties: {
          entry: {
            type: "string",
          },
          role: {
            type: "string",
            enum: [
              "admin",
              "operator",
              "member",
            ],
          },
          agents: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
      },
      UserCreateResponse: {
        type: "object",
        required: [
          "user",
        ],
        properties: {
          user: {
            $ref: "#/components/schemas/UserRow",
          },
        },
      },
      PlatformGoogle: {
        type: "object",
        required: [
          "clientId",
          "secretSet",
          "idFromDeploy",
          "secretFromDeploy",
        ],
        properties: {
          clientId: {
            type: "string",
          },
          secretSet: {
            type: "boolean",
            description: "True when a client secret is set. The secret itself is never returned.",
          },
          idFromDeploy: {
            type: "boolean",
          },
          secretFromDeploy: {
            type: "boolean",
          },
        },
      },
      PlatformKeys: {
        type: "object",
        required: [
          "google",
        ],
        properties: {
          google: {
            $ref: "#/components/schemas/PlatformGoogle",
          },
        },
      },
      PlatformKeysPatch: {
        type: "object",
        properties: {
          clientId: {
            type: [
              "string",
              "null",
            ],
            description: "Empty string or null clears the stored client id.",
          },
          clientSecret: {
            type: [
              "string",
              "null",
            ],
            description: "Empty string or null clears the stored client secret.",
          },
        },
      },
      OkTrue: {
        type: "object",
        required: [
          "ok",
        ],
        properties: {
          ok: {
            type: "boolean",
            const: true,
          },
        },
      },
      BrainState: {
        type: "string",
        enum: [
          "ready",
          "needs_keys",
          "error",
          "starting",
        ],
      },
      PluginStatus: {
        type: "object",
        required: [
          "name",
          "state",
        ],
        properties: {
          name: {
            type: "string",
          },
          state: {
            type: "string",
            enum: [
              "ready",
              "skipped",
            ],
          },
          reason: {
            type: "string",
          },
        },
      },
      SkippedPlugin: {
        type: "object",
        required: [
          "name",
          "reason",
        ],
        properties: {
          name: {
            type: "string",
          },
          reason: {
            type: "string",
          },
        },
      },
      AgentStatus: {
        type: "object",
        required: [
          "state",
          "since",
          "version",
          "lastTurnAt",
          "lastTurn",
          "plugins",
          "published",
          "skipped",
          "lastError",
          "perf",
        ],
        properties: {
          state: {
            $ref: "#/components/schemas/BrainState",
          },
          since: {
            type: "integer",
            nullable: true,
          },
          version: {
            type: "string",
          },
          lastTurnAt: {
            type: "integer",
            nullable: true,
          },
          lastTurn: {
            type: "integer",
            nullable: true,
          },
          plugins: {
            type: "array",
            items: {
              $ref: "#/components/schemas/PluginStatus",
            },
          },
          published: {
            type: "array",
            items: {
              type: "string",
            },
          },
          skipped: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SkippedPlugin",
            },
          },
          lastError: {
            type: "object",
            nullable: true,
            required: [
              "message",
              "at",
            ],
            properties: {
              message: {
                type: "string",
              },
              at: {
                type: "string",
              },
            },
          },
          perf: {
            type: "object",
            required: [
              "turns",
              "prompt",
              "completion",
              "errors",
            ],
            properties: {
              turns: {
                type: "integer",
              },
              prompt: {
                type: "integer",
              },
              completion: {
                type: "integer",
              },
              errors: {
                type: "integer",
              },
            },
          },
        },
      },
      AgentRow: {
        type: "object",
        required: [
          "slug",
          "name",
          "createdBy",
          "createdAt",
          "tags",
        ],
        properties: {
          slug: {
            type: "string",
          },
          name: {
            type: "string",
          },
          createdBy: {
            type: "string",
          },
          createdAt: {
            type: "integer",
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
      },
      AgentCard: {
        allOf: [
          {
            $ref: "#/components/schemas/AgentRow",
          },
          {
            type: "object",
            required: [
              "status",
              "canMutate",
            ],
            properties: {
              status: {
                oneOf: [
                  {
                    $ref: "#/components/schemas/AgentStatus",
                  },
                  {
                    type: "null",
                  },
                ],
              },
              canMutate: {
                type: "boolean",
              },
            },
          },
        ],
      },
      AgentList: {
        type: "object",
        required: [
          "agents",
        ],
        properties: {
          agents: {
            type: "array",
            items: {
              $ref: "#/components/schemas/AgentCard",
            },
          },
        },
      },
      AgentOne: {
        type: "object",
        required: [
          "agent",
        ],
        properties: {
          agent: {
            $ref: "#/components/schemas/AgentCard",
          },
        },
      },
      AgentCreate: {
        type: "object",
        required: [
          "slug",
        ],
        properties: {
          slug: {
            type: "string",
            pattern: "^[a-z][a-z0-9-]{0,31}$",
          },
          name: {
            type: "string",
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
      },
      AgentClone: {
        type: "object",
        required: [
          "slug",
        ],
        properties: {
          slug: {
            type: "string",
            pattern: "^[a-z][a-z0-9-]{0,31}$",
            description: "ID for the new agent.",
          },
          name: {
            type: "string",
            description: "Display name for the new agent.",
          },
          memories: {
            type: "boolean",
            description: "When true, copy memory rows from the source agent.",
          },
        },
      },
      AgentConfigView: {
        type: "object",
        required: [
          "envKeys",
          "house",
          "mcp",
          "persona",
          "updatedAt",
          "recreate",
        ],
        properties: {
          envKeys: {
            type: "array",
            items: {
              type: "string",
            },
          },
          house: {
            type: "array",
            items: {
              type: "string",
            },
          },
          mcp: {
            type: "string",
          },
          persona: {
            type: "string",
          },
          updatedAt: {
            type: "integer",
            nullable: true,
          },
          recreate: {
            type: "boolean",
          },
        },
      },
      AgentConfigPatch: {
        type: "object",
        properties: {
          env: {
            type: "object",
            additionalProperties: {
              oneOf: [
                {
                  type: "string",
                },
                {
                  type: "null",
                },
              ],
            },
          },
          mcp: {
            type: "string",
          },
          persona: {
            type: "string",
          },
        },
      },
      LogLine: {
        type: "object",
        required: [
          "seq",
          "at",
          "level",
          "message",
        ],
        properties: {
          seq: {
            type: "integer",
          },
          at: {
            type: "string",
          },
          level: {
            type: "string",
          },
          message: {
            type: "string",
          },
          dropped: {
            type: "integer",
          },
        },
      },
      LogPage: {
        type: "object",
        required: [
          "lines",
          "next",
        ],
        properties: {
          lines: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LogLine",
            },
          },
          next: {
            type: "integer",
          },
        },
      },
      RoomUser: {
        type: "object",
        properties: {
          sub: {
            type: "string",
          },
          email: {
            type: "string",
          },
        },
      },
      RoomUsers: {
        type: "object",
        required: [
          "users",
        ],
        properties: {
          users: {
            type: "array",
            items: {
              $ref: "#/components/schemas/RoomUser",
            },
          },
        },
      },
      BearerResponse: {
        type: "object",
        required: [
          "bearer",
        ],
        properties: {
          bearer: {
            type: "string",
          },
        },
      },
      AuthStartRequest: {
        type: "object",
        required: [
          "plugin",
        ],
        properties: {
          plugin: {
            type: "string",
            description: "Redirect plugin (`google`, `google-health`, `strava`).",
          },
        },
      },
      AuthStartResponse: {
        type: "object",
        required: [
          "url",
        ],
        properties: {
          url: {
            type: "string",
            format: "uri",
          },
        },
      },
      SelfView: {
        type: "object",
        required: [
          "text",
          "maxChars",
        ],
        properties: {
          text: {
            type: "string",
          },
          maxChars: {
            type: "integer",
          },
        },
      },
      SelfPut: {
        type: "object",
        required: [
          "text",
        ],
        properties: {
          text: {
            type: "string",
          },
        },
      },
      PersonaFile: {
        type: "object",
        required: [
          "name",
          "text",
          "updatedAt",
        ],
        properties: {
          name: {
            type: "string",
          },
          text: {
            type: "string",
          },
          updatedAt: {
            type: "integer",
          },
        },
      },
      PersonaView: {
        type: "object",
        required: [
          "files",
          "maxChars",
        ],
        properties: {
          files: {
            type: "array",
            items: {
              $ref: "#/components/schemas/PersonaFile",
            },
          },
          maxChars: {
            type: "integer",
          },
        },
      },
      PersonaWrite: {
        type: "object",
        required: [
          "name",
          "text",
        ],
        properties: {
          name: {
            type: "string",
          },
          text: {
            type: "string",
          },
        },
      },
      PersonaDelete: {
        type: "object",
        required: [
          "name",
        ],
        properties: {
          name: {
            type: "string",
          },
        },
      },
      ToolEntry: {
        type: "object",
        required: [
          "id",
          "binary",
          "needs",
          "optional",
          "oauth",
          "homeOnly",
        ],
        properties: {
          id: {
            type: "string",
          },
          binary: {
            type: "string",
          },
          needs: {
            type: "array",
            items: {
              type: "string",
            },
          },
          optional: {
            type: "array",
            items: {
              type: "string",
            },
          },
          oauth: {
            type: "boolean",
          },
          homeOnly: {
            type: "boolean",
          },
        },
      },
      ToolsList: {
        type: "object",
        required: [
          "tools",
          "house",
        ],
        properties: {
          tools: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ToolEntry",
            },
          },
          house: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
      },
      SampleRow: {
        type: "object",
        required: [
          "id",
          "at",
          "agent",
          "kind",
          "value",
        ],
        properties: {
          id: {
            type: "integer",
          },
          at: {
            type: "integer",
          },
          agent: {
            type: "string",
          },
          kind: {
            type: "string",
          },
          value: {
            type: "number",
          },
        },
      },
      SamplesList: {
        type: "object",
        required: [
          "samples",
        ],
        properties: {
          samples: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SampleRow",
            },
          },
        },
      },
      PushPublicKey: {
        type: "object",
        required: [
          "publicKey",
        ],
        properties: {
          publicKey: {
            type: "string",
          },
        },
      },
      PushSubKeys: {
        type: "object",
        required: [
          "p256dh",
          "auth",
        ],
        properties: {
          p256dh: {
            type: "string",
          },
          auth: {
            type: "string",
          },
        },
      },
      PushSub: {
        type: "object",
        required: [
          "endpoint",
          "keys",
        ],
        properties: {
          endpoint: {
            type: "string",
            format: "uri",
          },
          keys: {
            $ref: "#/components/schemas/PushSubKeys",
          },
        },
      },
      PushPut: {
        type: "object",
        required: [
          "slug",
          "subscription",
        ],
        properties: {
          slug: {
            type: "string",
          },
          subscription: {
            $ref: "#/components/schemas/PushSub",
          },
        },
      },
      PushDelete: {
        type: "object",
        required: [
          "slug",
          "endpoint",
        ],
        properties: {
          slug: {
            type: "string",
          },
          endpoint: {
            type: "string",
            format: "uri",
          },
        },
      },
      PushTest: {
        type: "object",
        required: [
          "slug",
        ],
        properties: {
          slug: {
            type: "string",
          },
        },
      },
      TtsOffer: {
        type: "object",
        required: [
          "voice",
        ],
        properties: {
          voice: {
            type: "boolean",
            const: true,
          },
        },
      },
      TtsRequest: {
        type: "object",
        required: [
          "text",
        ],
        properties: {
          text: {
            type: "string",
          },
          lang: {
            type: "string",
            description: "Phone language id (`en`, `ja`, `zh`, `vi`).",
          },
        },
      },
      ThemeWrite: {
        type: "object",
        required: [
          "theme",
        ],
        properties: {
          theme: {
            type: "string",
            description: "Known theme id (`lib/theme/catalog.ts`).",
          },
        },
      },
      ThemeCard: {
        type: "object",
        required: [
          "id",
          "label",
          "feel",
          "scheme",
          "mood",
          "canvas",
          "accent",
        ],
        properties: {
          id: {
            type: "string",
          },
          label: {
            type: "string",
          },
          feel: {
            type: "string",
          },
          scheme: {
            type: "string",
            enum: [
              "dark",
              "light",
            ],
          },
          mood: {
            type: "string",
          },
          canvas: {
            type: "string",
          },
          accent: {
            type: "string",
          },
        },
      },
      ThemeRead: {
        type: "object",
        required: [
          "theme",
          "themes",
        ],
        properties: {
          theme: {
            type: "string",
            nullable: true,
          },
          themes: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ThemeCard",
            },
          },
        },
      },
      ThemeWriteResponse: {
        type: "object",
        required: [
          "ok",
          "theme",
          "detail",
        ],
        properties: {
          ok: {
            type: "boolean",
          },
          theme: {
            type: "string",
            nullable: true,
          },
          detail: {
            type: "string",
          },
        },
      },
      FrameKind: {
        type: "string",
        enum: [
          "inbound",
          "reply",
          "push",
          "ack",
          "error",
          "pin",
          "cmds",
          "allow",
          "typing",
          "draft",
          "react",
          "aims",
          "todo",
        ],
      },
      FrameImage: {
        type: "object",
        required: [
          "url",
        ],
        properties: {
          url: {
            type: "string",
          },
        },
      },
      Geo: {
        type: "object",
        required: [
          "lat",
          "lon",
        ],
        properties: {
          lat: {
            type: "number",
          },
          lon: {
            type: "number",
          },
          accuracy_m: {
            type: "number",
          },
          alt_m: {
            type: "number",
          },
          heading: {
            type: "number",
          },
          speed_mps: {
            type: "number",
          },
        },
      },
      PhoneContext: {
        type: "object",
        properties: {
          at: {
            type: "string",
          },
          tz: {
            type: "string",
          },
          geo: {
            $ref: "#/components/schemas/Geo",
          },
          battery: {
            type: "object",
            properties: {
              pct: {
                type: "number",
              },
              charging: {
                type: "boolean",
              },
            },
          },
          net: {
            type: "string",
            enum: [
              "wifi",
              "cellular",
              "unknown",
            ],
          },
          surface: {
            type: "string",
            enum: [
              "browser",
              "android",
              "android_auto",
              "ios",
              "carplay",
            ],
          },
          input: {
            type: "string",
            enum: [
              "spoken",
            ],
          },
        },
      },
      SlashCommand: {
        type: "object",
        required: [
          "name",
          "hint",
        ],
        properties: {
          name: {
            type: "string",
          },
          hint: {
            type: "string",
          },
          args: {
            type: "boolean",
          },
        },
      },
      WireFrame: {
        type: "object",
        description: "JSON text frames on the mailbox socket. Caps in `lib/chat/frame.ts` and `lib/chat/caps.ts`.",
        properties: {
          kind: {
            $ref: "#/components/schemas/FrameKind",
          },
          text: {
            type: "string",
          },
          images: {
            type: "array",
            items: {
              $ref: "#/components/schemas/FrameImage",
            },
          },
          context: {
            $ref: "#/components/schemas/PhoneContext",
          },
          user_id: {
            type: "string",
          },
          email: {
            type: "string",
          },
          id: {
            type: "string",
          },
          seq: {
            type: "integer",
          },
          at: {
            type: "integer",
          },
          since: {
            type: "string",
          },
          commands: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SlashCommand",
            },
          },
          users: {
            type: "array",
            items: {
              $ref: "#/components/schemas/RoomUser",
            },
          },
          aims: {
            type: "array",
            items: {
              type: "object",
              description: "Aim board row (`lib/chat/aims.ts` `AimRow`).",
            },
          },
          links: {
            type: "array",
            items: {
              type: "object",
              description: "Cross-aim link (`lib/chat/aims.ts` `AimLink`).",
            },
          },
          todo: {
            type: "array",
            items: {
              type: "object",
              description: "Pocket list item (`lib/chat/todo.ts` `TodoItem`).",
            },
          },
          replay: {
            type: "boolean",
            const: true,
          },
          seen: {
            type: "boolean",
            const: true,
          },
        },
      },
    },
    responses: {
      ErrorJson: {
        description: "JSON error body.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      UnauthorizedJson: {
        description: "Missing or invalid session.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      ForbiddenJson: {
        description: "Signed in but not allowed.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
    },
  },
  paths: {
    "/api/health": {
      get: {
        tags: [
          "health",
        ],
        summary: "Liveness",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Health",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/google": {
      get: {
        tags: [
          "auth",
        ],
        summary: "Start Google OAuth",
        security: [],
        parameters: [
          {
            name: "next",
            in: "query",
            required: false,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          302: {
            description: "Redirect to Google.",
          },
          503: {
            description: "Login not configured.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/callback/google": {
      get: {
        tags: [
          "auth",
        ],
        summary: "Finish Google OAuth",
        security: [],
        parameters: [
          {
            name: "code",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
          },
          {
            name: "state",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          302: {
            description: "Sets `gantree_session` on success; misses redirect to `/login?error=`.",
          },
        },
      },
    },
    "/api/auth/config": {
      get: {
        tags: [
          "auth",
        ],
        summary: "Auth mode for clients",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthConfig",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/nonce": {
      get: {
        tags: [
          "auth",
        ],
        summary: "Nonce JWE for native sign-in",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthNonce",
                },
              },
            },
          },
          503: {
            description: "Not configured.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/token": {
      post: {
        tags: [
          "auth",
        ],
        summary: "Exchange Google ID token for session JWE",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AuthTokenRequest",
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthTokenResponse",
                },
              },
            },
          },
          400: {
            description: "bad_request",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          401: {
            description: "nonce or token",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          403: {
            description: "not_allowed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthTokenForbidden",
                },
              },
            },
          },
          503: {
            description: "not_configured",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/catch": {
      get: {
        tags: [
          "auth",
        ],
        summary: "OAuth plugin redirect target",
        description: "Path is on the gate public list so a missing cookie is plain text `unauthorized` (401), not an HTML login redirect.\nThe handler still requires the `gantree_session` cookie (not the session bearer).\n",
        security: [
          {
            sessionCookie: [],
          },
        ],
        parameters: [
          {
            name: "state",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
            description: "oauth-catch JWE `{ slug, plugin }`.",
          },
          {
            name: "code",
            in: "query",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          200: {
            description: "Connected message (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          400: {
            description: "bad state or missing code (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          401: {
            description: "unauthorized (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          403: {
            description: "forbidden (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          502: {
            description: "could not connect or one-line DO message (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          503: {
            description: "login not configured, agent unavailable, or no origin (text/plain).",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: [
          "auth",
        ],
        summary: "Clear session",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          303: {
            description: "Redirect to `/login`; clears cookie.",
          },
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: [
          "auth",
        ],
        summary: "Current principal",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Principal",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
          503: {
            $ref: "#/components/responses/ErrorJson",
          },
        },
      },
    },
    "/api/users": {
      get: {
        tags: [
          "users",
        ],
        summary: "List users and audit",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            description: "Admin only.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UsersList",
                },
              },
            },
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
        },
      },
      post: {
        tags: [
          "users",
        ],
        summary: "Add or update a user",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UserCreate",
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UserCreateResponse",
                },
              },
            },
          },
          400: {
            $ref: "#/components/responses/ErrorJson",
          },
          409: {
            description: "locked",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          503: {
            description: "settings_unavailable",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/users/{entry}": {
      delete: {
        tags: [
          "users",
        ],
        summary: "Remove a stored user",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            name: "entry",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OkTrue",
                },
              },
            },
          },
          404: {
            description: "not_found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          409: {
            description: "locked",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/platform/keys": {
      get: {
        tags: [
          "platform",
        ],
        summary: "Platform Google OAuth client",
        description: "Admin only. Returns the effective client id and whether a secret is set. Never returns the secret. A stored value overrides the Worker binding.",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PlatformKeys",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
        },
      },
      patch: {
        tags: [
          "platform",
        ],
        summary: "Store or clear the platform Google client",
        description: "Admin only. A non-empty value overrides the Worker binding until cleared. Empty string or null clears that field. The response never includes the secret.",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PlatformKeysPatch",
              },
            },
          },
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PlatformKeys",
                },
              },
            },
          },
          400: {
            description: "bad_json, bad_key, or bad_value",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
          503: {
            description: "settings_unavailable",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents": {
      get: {
        tags: [
          "agents",
        ],
        summary: "List agents",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentList",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
        },
      },
      post: {
        tags: [
          "agents",
        ],
        summary: "Create agent",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AgentCreate",
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentOne",
                },
              },
            },
          },
          409: {
            description: "exists",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}": {
      get: {
        tags: [
          "agents",
        ],
        summary: "One agent card",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentOne",
                },
              },
            },
          },
          404: {
            $ref: "#/components/responses/ErrorJson",
          },
        },
      },
      delete: {
        tags: [
          "agents",
        ],
        summary: "Delete agent",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          204: {
            description: "Deleted (admin only).",
          },
          404: {
            $ref: "#/components/responses/ErrorJson",
          },
        },
      },
    },
    "/api/agents/{slug}/clone": {
      post: {
        tags: [
          "agents",
        ],
        summary: "Clone agent keys and persona",
        description:
          "Creates a new agent and copies config.env, config.mcp, and config.persona from the source. Optional memory copy includes structured memory rows only — not chat, allow lists, OAuth tokens, or MFA state. Response is the new agent card; env values are never returned.",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AgentClone",
              },
            },
          },
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentOne",
                },
              },
            },
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
          404: {
            $ref: "#/components/responses/ErrorJson",
          },
          409: {
            $ref: "#/components/responses/ErrorJson",
          },
          503: {
            $ref: "#/components/responses/ErrorJson",
          },
        },
      },
    },
    "/api/agents/{slug}/enabled": {
      post: {
        tags: [
          "agents",
        ],
        summary: "Enable or disable agent",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "enabled",
                ],
                properties: {
                  enabled: {
                    type: "boolean",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentOne",
                },
              },
            },
          },
          404: {
            $ref: "#/components/responses/ErrorJson",
          },
        },
      },
    },
    "/api/agents/{slug}/config": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Agent config view",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentConfigView",
                },
              },
            },
          },
        },
      },
      patch: {
        tags: [
          "agents",
        ],
        summary: "Patch agent config",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AgentConfigPatch",
              },
            },
          },
        },
        responses: {
          200: {
            description: "Updated view from the Agent DO.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentConfigView",
                },
              },
            },
          },
          400: {
            description: "bad_config",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/self": {
      get: {
        tags: [
          "agents",
        ],
        summary: "SELF.md",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SelfView",
                },
              },
            },
          },
        },
      },
      put: {
        tags: [
          "agents",
        ],
        summary: "Write SELF.md",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SelfPut",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SelfView",
                },
              },
            },
          },
          400: {
            description: "bad_self or empty",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/persona": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Persona files",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PersonaView",
                },
              },
            },
          },
        },
      },
      put: {
        tags: [
          "agents",
        ],
        summary: "Write persona file",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PersonaWrite",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PersonaView",
                },
              },
            },
          },
          400: {
            description: "bad_persona or too_long",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      delete: {
        tags: [
          "agents",
        ],
        summary: "Delete persona file",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PersonaDelete",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PersonaView",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/auth/start": {
      post: {
        tags: [
          "agents",
        ],
        summary: "Start plugin OAuth",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AuthStartRequest",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthStartResponse",
                },
              },
            },
          },
          400: {
            description: "bad_plugin (Worker) or bad_auth / no_slug (DO)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          404: {
            description: "no_login",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          502: {
            description: "auth_failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          503: {
            description: "no_origin or login not configured",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/status": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Agent status",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentStatus",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/restart": {
      post: {
        tags: [
          "agents",
        ],
        summary: "Restart harness",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentStatus",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/log": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Agent log page",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
          {
            $ref: "#/components/parameters/LogAfter",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LogPage",
                },
              },
            },
          },
          400: {
            description: "bad cursor",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/users": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Room allow list",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RoomUsers",
                },
              },
            },
          },
        },
      },
      put: {
        tags: [
          "agents",
        ],
        summary: "Replace room allow list",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RoomUsers",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RoomUsers",
                },
              },
            },
          },
        },
      },
    },
    "/api/agents/{slug}/bearer": {
      get: {
        tags: [
          "agents",
        ],
        summary: "Room bearer (loopback dev only)",
        description: "Admin only. The route exists only when `GANTREE_DEV_USER` is set and the host is loopback (`devIdentity`).\nOn any other host the response is 404 `{ error: not_found }`, including for admins on a public host.\n",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BearerResponse",
                },
              },
            },
          },
          404: {
            description: "not_found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/tools": {
      get: {
        tags: [
          "tools",
        ],
        summary: "Tool catalog",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ToolsList",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
        },
      },
    },
    "/api/samples": {
      get: {
        tags: [
          "tools",
        ],
        summary: "Perf samples",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/SamplesAgent",
          },
          {
            $ref: "#/components/parameters/SamplesSince",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SamplesList",
                },
              },
            },
          },
          400: {
            description: "bad_since or bad_slug",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          403: {
            $ref: "#/components/responses/ForbiddenJson",
          },
        },
      },
    },
    "/api/chat/avatar": {
      get: {
        tags: [
          "chat",
        ],
        summary: "Room avatar JPEG",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        responses: {
          200: {
            description: "JPEG bytes.",
            content: {
              "image/jpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          400: {
            description: "bad slug",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          401: {
            $ref: "#/components/responses/UnauthorizedJson",
          },
          403: {
            description: "Body is { error: unauthorized }.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      post: {
        tags: [
          "chat",
        ],
        summary: "Upload room avatar",
        description: "Raw JPEG or `multipart/form-data` field `file` (`readAvatarUpload`).",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "image/jpeg": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "JPEG bytes from the DO.",
            content: {
              "image/jpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          400: {
            description: "Upload or JPEG validation error.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/chat/backdrop": {
      get: {
        tags: [
          "chat",
        ],
        summary: "Room backdrop JPEG",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        responses: {
          200: {
            content: {
              "image/jpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
        },
      },
      post: {
        tags: [
          "chat",
        ],
        summary: "Upload backdrop",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "image/jpeg": {
              schema: {
                type: "string",
                format: "binary",
              },
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "image/jpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
        },
      },
      delete: {
        tags: [
          "chat",
        ],
        summary: "Clear backdrop",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        responses: {
          200: {
            description: "DO response (often JPEG or empty).",
          },
        },
      },
    },
    "/api/chat/theme": {
      get: {
        tags: [
          "chat",
        ],
        summary: "Room theme",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ThemeRead",
                },
              },
            },
          },
          400: {
            description: "bad agent id",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      post: {
        tags: [
          "chat",
        ],
        summary: "Set room theme",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ThemeWrite",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ThemeWriteResponse",
                },
              },
            },
          },
          400: {
            description: "bad theme",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      delete: {
        tags: [
          "chat",
        ],
        summary: "Clear room theme",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugQuery",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ThemeWriteResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/chat/push": {
      get: {
        tags: [
          "chat",
        ],
        summary: "VAPID public key",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PushPublicKey",
                },
              },
            },
          },
          404: {
            description: "VAPID not configured (empty body).",
          },
        },
      },
      put: {
        tags: [
          "chat",
        ],
        summary: "Register push subscription",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PushPut",
              },
            },
          },
        },
        responses: {
          200: {
            description: "Forwarded to Agent DO.",
          },
          400: {
            description: "bad frame",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          413: {
            description: "too large",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      delete: {
        tags: [
          "chat",
        ],
        summary: "Drop push subscription",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PushDelete",
              },
            },
          },
        },
        responses: {
          400: {
            description: "bad frame",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          413: {
            description: "too large",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      post: {
        tags: [
          "chat",
        ],
        summary: "Push test ping",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PushTest",
              },
            },
          },
        },
        responses: {
          400: {
            description: "bad frame",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          413: {
            description: "too large",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/chat/tts": {
      get: {
        tags: [
          "chat",
        ],
        summary: "Pocket voice offered",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TtsOffer",
                },
              },
            },
          },
          404: {
            description: "Voice off or unconfigured.",
          },
        },
      },
      post: {
        tags: [
          "chat",
        ],
        summary: "Synthesize speech",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/TtsRequest",
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "audio/mpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          400: {
            description: "bad frame",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          404: {
            description: "Voice off or unconfigured.",
          },
          413: {
            description: "too large",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          502: {
            description: "tts",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/ws/{slug}": {
      get: {
        tags: [
          "mailbox",
        ],
        summary: "Mailbox WebSocket upgrade",
        description: "WebSocket upgrade (HTTP 101). Handled in `worker/index.ts` before Vinext middleware, not as a Vinext route.\nQuery `role` is required (`phone`, `crane`, or `agent`; `agent` is the harness role). Missing or unknown role → 404 `not found`. Bad slug → 404.\nOrigin check (`upgradeOriginOk`) → 403 `forbidden`.\nPhone (Google mode): `gantree_session` cookie, else session JWE on `Authorization`. Must be on the agent room list; else 403. No session → 401.\nCrane/agent (Google mode): room token on `Authorization` only (query `bearer` is not accepted in OIDC mode).\nSpike mode (no `GOOGLE_CLIENT_ID`, loopback only, `CHAT_SECRET`): query `secret` or bearer — no extra security scheme in this document.\nOn loopback with `GANTREE_DEV_USER`, a phone socket may be admitted without Google.\nSuccess is the Agent DO 101 upgrade. Messages are JSON text frames (`WireFrame`). Phone may send `inbound`, `pin`, `ack`, `react` (`PHONE_KINDS` in `lib/chat/route.ts`).\nThe DO may close sockets with WebSocket code `4401` (`unauthorized`). See `edge/agent.do.ts`.\n",
        security: [
          {
            sessionCookie: [],
          },
          {
            sessionBearer: [],
          },
          {
            roomBearer: [],
          },
        ],
        parameters: [
          {
            $ref: "#/components/parameters/AgentSlugPath",
          },
          {
            $ref: "#/components/parameters/WsRole",
          },
        ],
        responses: {
          101: {
            description: "Switching Protocols — WebSocket open.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WireFrame",
                },
                description: "Example frame shape; live traffic is JSON text frames, not an HTTP body.",
              },
            },
          },
          401: {
            description: "Unauthorized (HTTP before upgrade).",
          },
          403: {
            description: "Forbidden origin or room list miss (HTTP before upgrade).",
          },
          404: {
            description: "not found (bad role or slug).",
          },
        },
      },
    },
  },
} as const;

# image-generation-mcp — leftover

Human creates the GitHub repo (`shotah/image-generation-mcp`) and `git init`. Do not `git init` / `gh` from the agent.

## Follow-ups (not this binary)

- Extra `IMAGE_PROVIDER` backends (OpenAI, etc.) behind the existing `Provider` interface. Keep server id `image` and tools `photo_generate` / `photo_edit`.
- Pendant mailbox outbound photos (Telegram/Discord/Slack host follow-up is in ai-gantry).

## Done elsewhere

- Yard ingest: gantree `PACKAGES` + `HOST_SHAPE.image`.
- ai-gantry: MCP `ImageContent` stays off the model prompt; mouths `SendPhoto`.

## Do not

- Fold into `google-mcp` (Workspace OAuth cannot call Nano Banana)
- Name tools `image_*` (double prefix)
- Live API in unit tests

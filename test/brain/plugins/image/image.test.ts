import { describe, expect, it } from "vitest";
import {
  defaultImageOutputDir,
  imageRoots,
  isEnabled,
  loadImageConfig,
  defaultModel,
  withImageHandoff,
} from "@/brain/plugins/image/config";
import {
  extForMime,
  mimeFromPath,
  putOutputFile,
  readInsideRoots,
  readOutputFile,
  writeOutputFile,
  type PathMessages,
} from "@/brain/plugins/image/files";
import { buildBody, generateImage, parseGeminiResponse, validateAspectSize } from "@/brain/plugins/image/gemini";
import { decodeSourceImage, imagePlugin, readEditSource } from "@/brain/plugins/image/index";
import { b64, bodyText, callTool, hrefOf, jsonResponse, pluginCtx, textOf, textResponse } from "../helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const pathMessages: PathMessages = {
  needDir: "need dir",
  required: "required",
  refuse: "refuse",
  unreadable: "unreadable",
  empty: "empty",
};

function geminiBody(data: Uint8Array, mime = "image/png", note?: string): unknown {
  const parts: Record<string, unknown>[] = [];
  if (note) parts.push({ text: note });
  parts.push({ inlineData: { mimeType: mime, data: b64(data) } });
  return { candidates: [{ content: { parts } }] };
}

describe("image gemini", () => {
  it("builds a text part, then an image part ahead of the prompt", () => {
    const text = buildBody({ prompt: "a cat", aspectRatio: "", size: "", sourceMIME: "", sourceData: new Uint8Array() });
    const contents = text.contents as { parts: { text?: string }[] }[];
    expect(contents[0]?.parts).toEqual([{ text: "a cat" }]);
    const withSource = buildBody({
      prompt: "watercolor",
      aspectRatio: "",
      size: "",
      sourceMIME: "image/jpeg",
      sourceData: new Uint8Array([1, 2, 3]),
    });
    const parts = (withSource.contents as { parts: { text?: string; inlineData?: { mimeType: string } }[] }[])[0]?.parts ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[0]?.inlineData?.mimeType).toBe("image/jpeg");
    expect(parts[1]?.text).toBe("watercolor");
  });

  it("omits an empty imageConfig and keeps both modalities", () => {
    const empty = buildBody({ prompt: "x", aspectRatio: "", size: "", sourceMIME: "", sourceData: new Uint8Array() });
    expect((empty.generationConfig as { imageConfig?: unknown }).imageConfig).toBeUndefined();
    const got = buildBody({ prompt: "x", aspectRatio: "16:9", size: "2K", sourceMIME: "", sourceData: new Uint8Array() });
    const cfg = got.generationConfig as { imageConfig: { aspectRatio: string; imageSize: string }; responseModalities: string[] };
    expect(cfg.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
    expect(cfg.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });

  it("parses a candidate image and the miss cases", () => {
    const got = parseGeminiResponse("gemini-3.1-flash-image", geminiBody(PNG, "image/png", "here you go"));
    expect(got.note).toBe("here you go");
    expect(got.mime).toBe("image/png");
    expect(got.data).toEqual(PNG);
    expect(() => parseGeminiResponse("m", { candidates: [{ content: { parts: [{ text: "blocked" }] } }] })).toThrow("no image");
    expect(() => parseGeminiResponse("m", {})).toThrow("no candidates");
    expect(() => parseGeminiResponse("m", null)).toThrow();
  });

  it("decodes standard and data-url base64", () => {
    const raw = b64("hello");
    expect(new TextDecoder().decode(decodeSourceImage(raw))).toBe("hello");
    expect(new TextDecoder().decode(decodeSourceImage(`data:image/png;base64,${raw}`))).toBe("hello");
    expect(() => decodeSourceImage("")).toThrow("source_image is required");
    expect(() => decodeSourceImage("not-base64!!!")).toThrow("base64");
  });

  it("generates through fetch and refuses an unconfigured provider", async () => {
    const png = new Uint8Array([0x89, 0x50]);
    const got = await generateImage(
      {
        provider: "gemini",
        model: "gemini-3.1-flash-image",
        outputDir: "",
        apiKey: "k",
        useVertex: false,
        project: "",
        location: "",
        imageRoots: [],
      },
      async () => jsonResponse(geminiBody(png)),
      { prompt: "cat", aspectRatio: "", size: "", sourceMIME: "", sourceData: new Uint8Array() },
    );
    expect(got.data).toEqual(png);
    await expect(generateImage(
      {
        provider: "gemini",
        model: "x",
        outputDir: "",
        apiKey: "",
        useVertex: false,
        project: "",
        location: "",
        imageRoots: [],
      },
      fetch,
      { prompt: "cat", aspectRatio: "", size: "", sourceMIME: "", sourceData: new Uint8Array() },
    )).rejects.toThrow("not configured");
  });
});

describe("image config and files", () => {
  it("prefers IMAGE_API_KEY, piggybacks the crane key, and ignores LLM_MODEL", () => {
    expect(defaultModel).toBe("gemini-3.1-flash-image");
    const imageKey = loadImageConfig({
      IMAGE_API_KEY: "image-key",
      IMAGE_MODEL: "gemini-3.1-flash-image",
      LLM_API_KEY: "llm-key",
      LLM_MODEL: "qwen-local",
    });
    expect(imageKey).toMatchObject({ provider: "gemini", model: "gemini-3.1-flash-image", apiKey: "image-key" });
    const piggy = loadImageConfig({ LLM_API_KEY: "llm-key", LLM_MODEL: "gemini-3.8-flash" });
    expect(piggy).toMatchObject({ provider: "gemini", model: defaultModel, apiKey: "llm-key" });
    const vertex = loadImageConfig({ GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_CLOUD_PROJECT: "proj-1" });
    expect(vertex).toMatchObject({ useVertex: true, project: "proj-1", location: "global", apiKey: "" });
    expect(() => loadImageConfig({})).toThrow("IMAGE_API_KEY (or LLM_API_KEY) is required");
    expect(() => loadImageConfig({ IMAGE_API_KEY: "k", IMAGE_PROVIDER: "openai" })).toThrow("IMAGE_PROVIDER openai is not implemented");
    expect(() => loadImageConfig({ GOOGLE_GENAI_USE_VERTEXAI: "1" })).toThrow("GOOGLE_CLOUD_PROJECT is required");
  });

  it("treats the usual truthy flags as enabled", () => {
    for (const v of ["1", "true", "YES", " on "]) expect(isEnabled(v)).toBe(true);
    for (const v of ["", "0", "false"]) expect(isEnabled(v)).toBe(false);
  });

  it("round-trips handoff bytes under the default /images root", () => {
    const ctx = pluginCtx();
    const env = withImageHandoff({});
    expect(env.IMAGE_OUTPUT_DIR).toBe(defaultImageOutputDir);
    const roots = imageRoots(env);
    const bytes = new TextEncoder().encode("handoff-png");
    const stored = writeOutputFile(ctx.sql, ctx.clock, env.IMAGE_OUTPUT_DIR, bytes, extForMime("image/png"));
    expect(stored.startsWith(`${defaultImageOutputDir}/`)).toBe(true);
    expect(readInsideRoots(ctx.sql, stored, roots, pathMessages)).toEqual(bytes);
  });

  it("skips an unset dir, writes png and jpg, and rejects ..", () => {
    const ctx = pluginCtx();
    expect(writeOutputFile(ctx.sql, ctx.clock, "", new TextEncoder().encode("png"), ".png")).toBe("");
    const dir = "/tmp/gantree-image-out";
    const path = writeOutputFile(ctx.sql, ctx.clock, dir, new TextEncoder().encode("png-bytes"), extForMime("image/png"));
    expect(path.startsWith(`${dir}/`)).toBe(true);
    expect(path.endsWith(".png")).toBe(true);
    expect(new TextDecoder().decode(readOutputFile(ctx.sql, path) ?? new Uint8Array())).toBe("png-bytes");
    const jpg = writeOutputFile(ctx.sql, ctx.clock, dir, new TextEncoder().encode("jpg"), extForMime("image/jpeg"));
    expect(jpg.endsWith(".jpg")).toBe(true);
    expect(() => writeOutputFile(ctx.sql, ctx.clock, "../nope", PNG, ".png")).toThrow("concrete directory");
  });

  it("reads a file inside a root and refuses the rest", () => {
    const ctx = pluginCtx({ env: { IMAGE_OUTPUT_DIR: "/tmp/gantree-image-root" } });
    const path = "/tmp/gantree-image-root/face.jpg";
    putOutputFile(ctx.sql, path, new TextEncoder().encode("jpeg-bytes"));
    expect(readEditSource(ctx.sql, ctx.env, path, "", "")).toEqual({
      data: new TextEncoder().encode("jpeg-bytes"),
      mime: "image/jpeg",
    });
    expect(() => readEditSource(ctx.sql, ctx.env, "/etc/hostname", "", "")).toThrow("source_path");
    expect(() => readEditSource(ctx.sql, {}, "/tmp/x.png", "", "")).toThrow("IMAGE_OUTPUT_DIR");
    expect(() => readEditSource(ctx.sql, ctx.env, "a", "b", "")).toThrow("exactly one");
    const raw = b64("from-b64");
    expect(readEditSource(ctx.sql, {}, "", raw, "")).toEqual({
      data: new TextEncoder().encode("from-b64"),
      mime: "image/png",
    });
    expect(mimeFromPath("a.JPG")).toBe("image/jpeg");
    expect(mimeFromPath("a.webp")).toBe("image/webp");
    expect(mimeFromPath("a.png")).toBe("image/png");
  });
});

describe("image plugin", () => {
  it("stays available without a key and does not prefix tools with image", async () => {
    expect(imagePlugin.name).toBe("image");
    expect(await imagePlugin.ready(pluginCtx())).toBeNull();
    const tools = imagePlugin.tools(pluginCtx());
    expect(tools.map((t) => t.name)).toEqual(["photo_generate", "photo_edit"]);
    for (const tool of tools) {
      expect(tool.name.startsWith("image")).toBe(false);
      expect(tool.name).toMatch(/^[a-z]+_[a-z]+/);
    }
    expect(tools[0]?.description).toContain("pendant__avatar_update");
    expect(tools[1]?.description).toContain("pendant__avatar_get");
    expect(tools[0]?.inputSchema).toMatchObject({ required: ["prompt"] });
    expect(tools[1]?.inputSchema).toMatchObject({ required: ["prompt"] });
  });

  it("generates, writes a path, and teaches in on a missing prompt or key", async () => {
    let aspect = "";
    const ctx = pluginCtx({
      env: { IMAGE_API_KEY: "k" },
      fetch: async (_input, init) => {
        const body = JSON.parse(bodyText(init?.body)) as { generationConfig?: { imageConfig?: { aspectRatio?: string } } };
        aspect = body.generationConfig?.imageConfig?.aspectRatio ?? "";
        return jsonResponse(geminiBody(PNG, "image/png", "ok"));
      },
    });
    const result = await callTool(imagePlugin, ctx, "photo_generate", { prompt: "a red bicycle", aspect_ratio: "16:9" });
    expect(result.isError).toBeUndefined();
    const sum = JSON.parse(textOf(result)) as { prompt: string; bytes: number; mime: string }[];
    expect(sum[0]).toMatchObject({ prompt: "a red bicycle", bytes: PNG.byteLength, mime: "image/png" });
    expect(aspect).toBe("16:9");
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

    const missingPrompt = await callTool(imagePlugin, pluginCtx(), "photo_generate", {});
    expect(missingPrompt.isError).toBe(true);
    expect(textOf(missingPrompt)).toContain("prompt");
    const missingKey = await callTool(imagePlugin, pluginCtx(), "photo_generate", { prompt: "cat" });
    expect(textOf(missingKey)).toContain("IMAGE_API_KEY");

    const dir = "/tmp/gantree-image-plugin";
    const written = pluginCtx({
      env: { IMAGE_API_KEY: "k", IMAGE_OUTPUT_DIR: dir },
      fetch: async () => jsonResponse(geminiBody(PNG)),
    });
    const saved = JSON.parse(textOf(await callTool(imagePlugin, written, "photo_generate", { prompt: "batman portrait", aspect_ratio: "1:1" }))) as { path: string }[];
    expect(saved[0]?.path.startsWith(`${dir}/`)).toBe(true);
  });

  it("edits from a path or base64 and refuses a path outside the root", async () => {
    const root = "/tmp/gantree-image-edit";
    const src = PNG;
    const path = `${root}/face.png`;
    let posted = "";
    const ctx = pluginCtx({
      env: { IMAGE_API_KEY: "k", IMAGE_OUTPUT_DIR: root },
      fetch: async (_input, init) => {
        posted = bodyText(init?.body);
        return jsonResponse(geminiBody(new Uint8Array([0x89, 0x50])));
      },
    });
    putOutputFile(ctx.sql, path, src);
    const edited = await callTool(imagePlugin, ctx, "photo_edit", { prompt: "add a hat", source_path: path });
    expect(edited.isError).toBeUndefined();
    expect(posted).toContain(b64(src));
    const outside = await callTool(imagePlugin, ctx, "photo_edit", { prompt: "add a hat", source_path: "/etc/hostname" });
    expect(outside.isError).toBeUndefined();
    const outsideRows = JSON.parse(textOf(outside)) as { error?: string }[];
    expect(outsideRows[0]?.error).toContain("source_path");

    const encoded = b64(new Uint8Array([0x01, 0x02]));
    const fromBytes = pluginCtx({
      env: { IMAGE_API_KEY: "k" },
      fetch: async () => jsonResponse(geminiBody(new Uint8Array([0x89, 0x50]))),
    });
    const text = textOf(await callTool(imagePlugin, fromBytes, "photo_edit", { prompt: "watercolor", source_image: encoded }));
    expect(text).toContain(`"bytes":2`);
  });

  it("rejects a bad aspect or size", () => {
    expect(() => validateAspectSize("7:5", "")).toThrow("aspect_ratio");
    expect(() => validateAspectSize("", "8K")).toThrow("size");
    expect(() => validateAspectSize("1:1", "1K")).not.toThrow();
  });

  it("posts to AI Studio with the key in a header, not the URL", async () => {
    let url = "";
    let key = "";
    const ctx = pluginCtx({
      env: { IMAGE_API_KEY: "studio-key", IMAGE_MODEL: "gemini-3.1-flash-image" },
      fetch: async (input, init) => {
        url = hrefOf(input);
        key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
        return jsonResponse(geminiBody(PNG));
      },
    });
    await callTool(imagePlugin, ctx, "photo_generate", { prompt: "cat" });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(url).not.toContain("studio-key");
    expect(key).toBe("studio-key");
  });

  it("builds a Vertex URL without putting the project key in a bearer", async () => {
    let url = "";
    let auth = "";
    const ctx = pluginCtx({
      env: {
        GOOGLE_GENAI_USE_VERTEXAI: "true",
        GOOGLE_CLOUD_PROJECT: "proj-1",
        GOOGLE_CLOUD_LOCATION: "us-central1",
      },
      fetch: async (input, init) => {
        url = hrefOf(input);
        auth = new Headers(init?.headers).get("authorization") ?? "";
        return textResponse("denied", 401);
      },
    });
    const result = await callTool(imagePlugin, ctx, "photo_generate", { prompt: "cat" });
    const rows = JSON.parse(textOf(result)) as { error?: string }[];
    expect(result.isError).toBeUndefined();
    expect(rows[0]?.error).toContain("401");
    expect(url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/gemini-3.1-flash-image:generateContent");
    expect(auth).toBe("");
  });

  it("generates each prompt and edits each image, capped at 4", async () => {
    let calls = 0;
    const ctx = pluginCtx({
      env: { IMAGE_API_KEY: "k" },
      fetch: async () => {
        calls += 1;
        return jsonResponse(geminiBody(PNG));
      },
    });
    const generated = JSON.parse(textOf(await callTool(imagePlugin, ctx, "photo_generate", { prompts: ["cat", "dog"] }))) as { prompt: string }[];
    expect(generated.map((row) => row.prompt)).toEqual(["cat", "dog"]);
    expect(calls).toBe(2);
    const over = await callTool(imagePlugin, ctx, "photo_generate", { prompts: ["a", "b", "c", "d", "e"] });
    expect(over.isError).toBe(true);
    expect(textOf(over)).toContain("at most 4");
    const encoded = b64(PNG);
    const edited = JSON.parse(textOf(await callTool(imagePlugin, ctx, "photo_edit", {
      images: [
        { prompt: "hat", source_image: encoded },
        { prompt: "coat", source_image: encoded },
      ],
    }))) as { prompt: string }[];
    expect(edited.map((row) => row.prompt)).toEqual(["hat", "coat"]);
    expect(calls).toBe(4);
  });
});

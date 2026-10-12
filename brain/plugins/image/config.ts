export const envImageAPIKey = "IMAGE_API_KEY";
export const envImageModel = "IMAGE_MODEL";
export const envImageProvider = "IMAGE_PROVIDER";
export const envImageOutputDir = "IMAGE_OUTPUT_DIR";
export const envPendantImageDir = "PENDANT_IMAGE_DIR";
export const envLLMAPIKey = "LLM_API_KEY";
export const envGoogleCloudProject = "GOOGLE_CLOUD_PROJECT";
export const envGoogleCloudLocation = "GOOGLE_CLOUD_LOCATION";
export const envGoogleGenAIUseVertexAI = "GOOGLE_GENAI_USE_VERTEXAI";

export const providerGemini = "gemini";
export const defaultModel = "gemini-3.1-flash-image";
export const defaultLocation = "global";
export const defaultImageOutputDir = "/images";

export function withImageHandoff(env: Record<string, string>): Record<string, string> {
  if ((env.IMAGE_OUTPUT_DIR ?? "").trim() || (env.PENDANT_IMAGE_DIR ?? "").trim()) return env;
  return { ...env, IMAGE_OUTPUT_DIR: defaultImageOutputDir };
}

const nextGenerate = "Next: photo_generate(prompt=\"a red bicycle leaning on a brick wall\")";

export type ImageConfig = {
  provider: string;
  model: string;
  outputDir: string;
  apiKey: string;
  useVertex: boolean;
  project: string;
  location: string;
  imageRoots: string[];
};

export function loadImageConfig(env: Readonly<Record<string, string>>): ImageConfig {
  const provider = (env[envImageProvider] ?? "").trim().toLowerCase() || providerGemini;
  const model = (env[envImageModel] ?? "").trim() || defaultModel;
  const outputDir = (env[envImageOutputDir] ?? "").trim();
  if (provider !== providerGemini) {
    throw new Error(`${envImageProvider} ${provider} is not implemented. Supported: gemini (Nano Banana). Next: set ${envImageProvider}=${providerGemini}`);
  }
  const useVertex = isEnabled(env[envGoogleGenAIUseVertexAI] ?? "");
  const roots = imageRoots(env);
  if (useVertex) {
    const project = (env[envGoogleCloudProject] ?? "").trim();
    if (!project) throw new Error(`${envGoogleCloudProject} is required when ${envGoogleGenAIUseVertexAI} is set`);
    const location = (env[envGoogleCloudLocation] ?? "").trim() || defaultLocation;
    return { provider, model, outputDir, apiKey: "", useVertex: true, project, location, imageRoots: roots };
  }
  const apiKey = firstNonEmpty(env[envImageAPIKey] ?? "", env[envLLMAPIKey] ?? "");
  if (!apiKey) {
    throw new Error(`${envImageAPIKey} (or ${envLLMAPIKey}) is required when using Google AI Studio. ${nextGenerate}`);
  }
  return { provider, model, outputDir, apiKey, useVertex: false, project: "", location: "", imageRoots: roots };
}

export function imageRoots(env: Readonly<Record<string, string>>): string[] {
  const roots: string[] = [];
  for (const key of [envImageOutputDir, envPendantImageDir]) {
    const dir = (env[key] ?? "").trim();
    if (dir) roots.push(dir);
  }
  return roots;
}

export function isEnabled(value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const t = value.trim();
    if (t) return t;
  }
  return "";
}

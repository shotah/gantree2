import { getTools } from "@/lib/agents/toolsHttp";

export function GET(request: Request): Response {
  return getTools(request);
}

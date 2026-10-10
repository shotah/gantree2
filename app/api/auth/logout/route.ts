import { logout } from "@/lib/door/http";

export function POST(request: Request): Response {
  return logout(request);
}

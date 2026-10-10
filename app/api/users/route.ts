import { getUsers, postUser } from "@/lib/door/usersHttp";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return getUsers(request, doorEnv(), userStore());
}

export function POST(request: Request): Promise<Response> {
  return postUser(request, doorEnv(), userStore());
}

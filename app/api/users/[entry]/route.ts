import { deleteUser } from "@/lib/door/usersHttp";
import { doorEnv, userStore } from "@/lib/door/runtime";

export async function DELETE(request: Request, context: { params: Promise<{ entry: string }> }): Promise<Response> {
  const { entry } = await context.params;
  return deleteUser(request, doorEnv(), userStore(), entry);
}

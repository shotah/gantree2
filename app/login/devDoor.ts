/** Server-only: this request's host and the Worker env, into the pure `devDoor`. */
import { headers } from "next/headers";
import { devDoor, type DevDoor } from "@/app/lib/login";
import { doorEnv } from "@/lib/door/runtime";

export async function devDoorFor(next: string | null): Promise<DevDoor | null> {
  try {
    return devDoor(doorEnv(), (await headers()).get("host"), next);
  } catch {
    return null;
  }
}

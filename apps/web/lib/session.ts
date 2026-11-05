import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, membership } from "@infradeck/core";
export async function scope(allowProjectRestricted = false) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const s = await membership(session.user.id, (await cookies()).get("workspace")?.value);
  if (s.projectRestricted && !allowProjectRestricted) redirect("/my-projects");
  return s;
}

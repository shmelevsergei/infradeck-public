import { redirect } from "next/navigation";
import { db } from "@infradeck/db";
export const dynamic = "force-dynamic";
export default async function Page() {
  redirect((await db.installation.count()) ? "/dashboard" : "/setup");
}

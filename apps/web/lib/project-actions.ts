"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { scope } from "./session";
import type { ActionState } from "./actions";
import {
  manageProjectAccess,
  saveProjectBudget,
  acknowledgeProjectAlert,
} from "../../../packages/core/src/projects";
export async function projectAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
    )
      throw new Error("Invalid origin");
    const s = await scope();
    const v = (k: string) => String(f.get(k) ?? "").trim();
    if (v("kind") === "budget")
      await saveProjectBudget(
        s,
        {
          projectId: v("projectId"),
          month: v("month"),
          currency: v("currency"),
          amount: v("amount"),
          version: Number(v("version") || 0),
        },
        v("remove") === "true",
      );
    else if (v("kind") === "grant")
      await manageProjectAccess(s, {
        userId: v("userId"),
        projectId: v("projectId"),
        role: v("role"),
        allowHostMetrics: v("allowHostMetrics") === "true",
        remove: v("remove") === "true",
      });
    else if (v("kind") === "memberMode")
      await manageProjectAccess(s, {
        userId: v("userId"),
        projectRestricted: v("mode") === "PROJECTS",
      });
    else throw new Error("Invalid operation");
    revalidatePath("/project-settings");
    revalidatePath("/my-projects");
    return { success: "Сохранено / Saved" };
  } catch {
    return {
      error:
        "Проверьте права, поля и версию данных. Обновите страницу / Check permissions, fields and data version. Refresh the page",
    };
  }
}
export async function acknowledgeProjectAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
    )
      throw new Error("Invalid origin");
    await acknowledgeProjectAlert(await scope(true), String(f.get("id") ?? ""));
    revalidatePath("/my-projects");
    return { success: "Подтверждено / Acknowledged" };
  } catch {
    return {
      error: "Недостаточно проектных прав / Insufficient project permissions",
    };
  }
}

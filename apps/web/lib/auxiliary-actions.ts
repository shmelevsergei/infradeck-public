"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { scope } from "./session";
import type { ActionState } from "./actions";
import { mutateAuxiliary } from "../../../packages/core/src/auxiliary";
import {
  auxiliarySchemas,
  type AuxiliaryModel,
} from "../../../packages/shared/src/auxiliary";
export async function auxiliaryAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") &&
      h.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
    )
      throw new Error("Invalid origin");
    const model = String(f.get("model")) as AuxiliaryModel;
    if (!Object.hasOwn(auxiliarySchemas, model))
      throw new Error("Invalid model");
    await mutateAuxiliary(
      await scope(),
      model,
      String(f.get("id")),
      Object.fromEntries(f),
      f.get("kind") === "remove",
      String(f.get("confirmation") ?? ""),
    );
    revalidatePath("/", "layout");
    return { success: "Сохранено / Saved" };
  } catch {
    return {
      error:
        "Проверьте поля, зависимости и права / Check fields, dependencies and permissions",
    };
  }
}

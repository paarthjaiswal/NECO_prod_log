"use server";

import { revalidatePath } from "next/cache";
import { createSessionClient } from "@/utils/supabase/server";

export interface AuthActionResult {
  success: boolean;
  error?: string;
}

/**
 * Logs in the Unit Head administrator.
 * Regular shop-floor users do NOT log in. Only Unit Head logs in via /unit-head
 * to gain elevated overrides.
 */
export async function loginUnitHead(
  password: string,
  email?: string
): Promise<AuthActionResult> {
  try {
    const supabase = await createSessionClient();
    const targetEmail =
      email && email.trim().length > 0
        ? email.trim()
        : process.env.UNIT_HEAD_EMAIL || "unithead@neco.com";

    const { error } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password,
    });

    if (error) {
      return { success: false, error: "Invalid Unit Head credentials." };
    }

    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("loginUnitHead unexpected error:", err);
    return { success: false, error: "Invalid Unit Head credentials." };
  }
}

/**
 * Logs out the Unit Head administrator, returning the session to open-book mode.
 */
export async function logoutUnitHead(): Promise<AuthActionResult> {
  try {
    const supabase = await createSessionClient();
    await supabase.auth.signOut();
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    console.error("logoutUnitHead unexpected error:", err);
    return { success: false, error: "Failed to sign out." };
  }
}

/**
 * Checks whether the current request is from an authenticated Unit Head.
 */
export async function getIsUnitHead(): Promise<boolean> {
  try {
    const supabase = await createSessionClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

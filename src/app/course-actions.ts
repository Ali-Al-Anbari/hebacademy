"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return { supabase, userId: data.claims.sub };
}

export async function createCourse(name: string) {
  const { supabase, userId } = await authenticatedClient();
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || trimmedName.length > 120) {
    return { error: "Enter a course name of 1 to 120 characters." };
  }

  const { error } = await supabase.from("courses").insert({
    name: trimmedName,
    user_id: userId,
  });
  if (error) {
    console.error("Failed to create course:", error);
    return { error: "Could not add the course. Please try again." };
  }

  revalidatePath("/");
  return { error: null };
}

export async function renameCourse(id: string, name: string) {
  const { supabase, userId } = await authenticatedClient();
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || trimmedName.length > 120) {
    return { error: "Enter a course name of 1 to 120 characters." };
  }
  if (typeof id !== "string" || !validId(id)) {
    return { error: "Could not rename the course. Please try again." };
  }

  const { data, error } = await supabase
    .from("courses")
    .update({ name: trimmedName })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to rename course:", error);
    return { error: "Could not rename the course. Please try again." };
  }

  revalidatePath("/");
  revalidatePath(`/courses/${id}`);
  return { error: null };
}

export async function deleteCourse(id: string) {
  const { supabase, userId } = await authenticatedClient();
  if (typeof id !== "string" || !validId(id)) {
    return { error: "Could not delete the course. Please try again." };
  }

  const { data, error } = await supabase
    .from("courses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to delete course:", error);
    return { error: "Could not delete the course. Please try again." };
  }

  revalidatePath("/");
  revalidatePath(`/courses/${id}`);
  return { error: null };
}

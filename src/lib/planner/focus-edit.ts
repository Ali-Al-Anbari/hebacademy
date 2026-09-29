export function focusTextPatch(value: unknown, updatedAt: string) {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > 500) return null;
  return { title, updated_at: updatedAt };
}

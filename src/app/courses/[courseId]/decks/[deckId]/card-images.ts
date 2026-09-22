import { createClient } from "@/lib/supabase/client";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function uploadCardImage(file: File, userId: string, deckId: string, cardId: string) {
  const extension = extensions[file.type];
  if (!extension || file.size > 5 * 1024 * 1024 || file.size === 0) {
    throw new Error("Choose a JPEG, PNG, WebP, or GIF image under 5 MB.");
  }
  const path = `${userId}/${deckId}/${cardId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await createClient().storage.from("card-images").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    console.error("Failed to upload card image:", error);
    throw new Error("Image upload failed. Please try again.");
  }
  return path;
}

export async function removeCardImages(paths: string[]) {
  if (!paths.length) return;
  const { error } = await createClient().storage.from("card-images").remove(paths);
  if (error) console.error("Failed to clean up card images:", error);
}

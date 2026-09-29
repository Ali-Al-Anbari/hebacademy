export type StickyNoteFields = {
  title: string;
  body: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function sameStickyNoteContent(a: StickyNoteFields, b: StickyNoteFields): boolean {
  return a.title === b.title && a.body === b.body && a.color === b.color
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function stickyNoteTextChanged(draft: Pick<StickyNoteFields, "title" | "body">, saved: Pick<StickyNoteFields, "title" | "body">): boolean {
  return draft.title !== saved.title || draft.body !== saved.body;
}

export async function persistStickyTextDraft<T extends StickyNoteFields>(
  saved: T,
  draft: Pick<StickyNoteFields, "title" | "body">,
  persist: (next: T) => Promise<void>
): Promise<T> {
  const next = { ...saved, ...draft };
  await persist(next);
  return next;
}

export function stickyNoteSavePayload<T extends StickyNoteFields & { id: string; is_open: boolean }>(
  note: T, userId: string, titleSupported: boolean
) {
  return {
    id: note.id, user_id: userId, body: note.body, color: note.color,
    x: Math.round(note.x), y: Math.round(note.y),
    width: Math.round(note.width), height: Math.round(note.height),
    is_open: note.is_open, updated_at: new Date().toISOString(),
    ...(titleSupported ? { title: note.title } : {}),
  };
}

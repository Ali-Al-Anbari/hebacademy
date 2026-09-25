"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDateOnly, isTime, isTimeZone, weekdayOf } from "@/lib/planner/dates";
import type { CourseDraft, MeetingChange, MeetingSlot, SemesterDraft } from "@/lib/planner/types";
import { createClient } from "@/lib/supabase/server";

const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function authenticated() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  return { supabase, userId: data.claims.sub };
}

async function ownedSemester(id: string) {
  const context = await authenticated();
  if (!isId(id)) return null;
  const { data, error } = await context.supabase.from("planner_semesters")
    .select("id, start_date, end_date").eq("id", id).eq("user_id", context.userId).maybeSingle();
  if (error) console.error("Planner semester lookup failed:", error);
  return data && !error ? { ...context, semester: data } : null;
}

async function ownedCourse(id: string) {
  const context = await authenticated();
  if (!isId(id)) return null;
  const { data, error } = await context.supabase.from("planner_courses")
    .select("id, semester_id").eq("id", id).eq("user_id", context.userId).maybeSingle();
  if (error) console.error("Planner course lookup failed:", error);
  return data && !error ? { ...context, course: data } : null;
}

async function ownedMeeting(id: string) {
  const context = await authenticated();
  if (!isId(id)) return null;
  const { data, error } = await context.supabase.from("planner_course_meetings")
    .select("id, semester_id, planner_course_id, weekday, starts_at, ends_at, location")
    .eq("id", id).eq("user_id", context.userId).maybeSingle();
  if (error) console.error("Planner meeting lookup failed:", error);
  if (!data || error) return null;
  const semester = await ownedSemester(data.semester_id);
  return semester ? { ...semester, meeting: data } : null;
}

function validateSemester(input: SemesterDraft) {
  if (!input || typeof input !== "object") return "Complete the semester details.";
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) {
    return "Enter a semester name of 1 to 120 characters.";
  }
  if (!isDateOnly(input.start_date) || !isDateOnly(input.end_date)
      || input.end_date < input.start_date) return "Choose a valid semester date range.";
  if (!isTimeZone(input.time_zone)) return "Enter a valid IANA time zone.";
  return null;
}

export async function saveSemester(id: string | null, input: SemesterDraft) {
  const invalid = validateSemester(input);
  if (invalid) return { error: invalid, id: null as string | null };
  const values = { name: input.name.trim(), start_date: input.start_date,
    end_date: input.end_date, time_zone: input.time_zone.trim(), updated_at: new Date().toISOString() };
  if (id !== null) {
    const context = await ownedSemester(id);
    if (!context) return { error: "This semester is unavailable.", id: null };
    const { data, error } = await context.supabase.from("planner_semesters")
      .update(values).eq("id", id).eq("user_id", context.userId).select("id").maybeSingle();
    if (error || !data) {
      if (error) console.error("Could not update planner semester:", error);
      return { error: "Could not save the semester. Please try again.", id: null };
    }
    revalidatePath("/planner");
    return { error: null, id };
  }
  const { supabase, userId } = await authenticated();
  const { data, error } = await supabase.from("planner_semesters")
    .insert({ ...values, user_id: userId }).select("id").single();
  if (error || !data) {
    if (error) console.error("Could not create planner semester:", error);
    return { error: "Could not create the semester. Please try again.", id: null };
  }
  revalidatePath("/planner");
  return { error: null, id: data.id };
}

export async function setSemesterArchived(id: string, archived: boolean) {
  if (typeof archived !== "boolean") return { error: "Invalid archive request." };
  const context = await ownedSemester(id);
  if (!context) return { error: "This semester is unavailable." };
  const { data, error } = await context.supabase.from("planner_semesters")
    .update({ archived_at: archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Could not archive planner semester:", error);
    return { error: "Could not change the semester archive state.", };
  }
  revalidatePath("/planner");
  return { error: null };
}

export async function deleteSemester(id: string) {
  const context = await ownedSemester(id);
  if (!context) return { error: "This semester is unavailable." };
  const { data, error } = await context.supabase.from("planner_semesters")
    .delete().eq("id", id).eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Could not delete planner semester:", error);
    return { error: "Could not delete the semester. Please try again." };
  }
  revalidatePath("/planner");
  return { error: null };
}

function validateCourse(input: CourseDraft) {
  if (!input || typeof input !== "object") return "Complete the class details.";
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) {
    return "Enter a class name of 1 to 120 characters.";
  }
  if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color)) {
    return "Choose a valid class color.";
  }
  if (input.hebacademy_course_id !== null && !isId(input.hebacademy_course_id)) {
    return "Choose a valid Hebacademy course or leave the link empty.";
  }
  return null;
}

export async function savePlannerCourse(id: string | null, semesterId: string, input: CourseDraft) {
  const invalid = validateCourse(input);
  if (invalid) return { error: invalid, id: null as string | null };
  const context = await ownedSemester(semesterId);
  if (!context) return { error: "This semester is unavailable.", id: null };
  if (input.hebacademy_course_id) {
    const { data, error } = await context.supabase.from("courses")
      .select("id").eq("id", input.hebacademy_course_id)
      .eq("user_id", context.userId).maybeSingle();
    if (error || !data) {
      if (error) console.error("Could not verify linked course:", error);
      return { error: "The linked Hebacademy course is unavailable.", id: null };
    }
  }
  const values = { name: input.name.trim(), color: input.color.toUpperCase(),
    hebacademy_course_id: input.hebacademy_course_id, updated_at: new Date().toISOString() };
  if (id !== null) {
    const owned = await ownedCourse(id);
    if (!owned || owned.course.semester_id !== semesterId) {
      return { error: "This planner class is unavailable.", id: null };
    }
    const { data, error } = await context.supabase.from("planner_courses")
      .update(values).eq("id", id).eq("user_id", context.userId)
      .eq("semester_id", semesterId).select("id").maybeSingle();
    if (error || !data) {
      if (error) console.error("Could not update planner class:", error);
      return { error: "Could not save the class. Please try again.", id: null };
    }
    revalidatePath("/planner");
    return { error: null, id };
  }
  const { data, error } = await context.supabase.from("planner_courses")
    .insert({ ...values, semester_id: semesterId, user_id: context.userId })
    .select("id").single();
  if (error || !data) {
    if (error) console.error("Could not create planner class:", error);
    return { error: "Could not create the class. Please try again.", id: null };
  }
  revalidatePath("/planner");
  return { error: null, id: data.id };
}

export async function deletePlannerCourse(id: string) {
  const context = await ownedCourse(id);
  if (!context) return { error: "This planner class is unavailable." };
  const { data, error } = await context.supabase.from("planner_courses")
    .delete().eq("id", id).eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Could not delete planner class:", error);
    return { error: "Could not delete the class. Please try again." };
  }
  revalidatePath("/planner");
  return { error: null };
}

function validateSlots(slots: MeetingSlot[]) {
  if (!Array.isArray(slots) || slots.length > 35) return "Choose up to 35 weekly meeting slots.";
  const keys = new Set<string>();
  for (const slot of slots) {
    if (!slot || !Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7
      || !isTime(slot.starts_at) || !isTime(slot.ends_at)
      || slot.ends_at <= slot.starts_at
      || (slot.location !== null && (typeof slot.location !== "string" || slot.location.length > 200))) {
      return "Check meeting days, times, and locations.";
    }
    const key = `${slot.weekday}:${slot.starts_at.slice(0, 5)}:${slot.ends_at.slice(0, 5)}`;
    if (keys.has(key)) return "Remove duplicate meeting slots.";
    keys.add(key);
  }
  return null;
}

// One batch upsert, then one batch delete. If the delete fails, restore the
// prior rows and remove new rows; never claim success for a partial result.
export async function saveCourseMeetings(courseId: string, slots: MeetingSlot[]) {
  const context = await ownedCourse(courseId);
  if (!context) return { error: "This planner class is unavailable." };
  const invalid = validateSlots(slots);
  if (invalid) return { error: invalid };
  const { data: existing, error: loadError } = await context.supabase
    .from("planner_course_meetings")
    .select("id, weekday, starts_at, ends_at, location, created_at")
    .eq("planner_course_id", courseId).eq("semester_id", context.course.semester_id)
    .eq("user_id", context.userId);
  if (loadError || !existing) {
    if (loadError) console.error("Could not load planner meetings:", loadError);
    return { error: "Could not load the current class schedule." };
  }
  const key = (slot: MeetingSlot) => `${slot.weekday}:${slot.starts_at.slice(0, 5)}:${slot.ends_at.slice(0, 5)}`;
  const existingByKey = new Map(existing.map((meeting) => [key(meeting), meeting]));
  const wanted = new Set(slots.map(key));
  const addedIds: string[] = [];
  const changes = slots.flatMap((slot) => {
    const previous = existingByKey.get(key(slot));
    const location = slot.location?.trim() || null;
    if (previous && previous.location === location) return [];
    const id = previous?.id ?? crypto.randomUUID();
    if (!previous) addedIds.push(id);
    return [{ id, user_id: context.userId, semester_id: context.course.semester_id,
      planner_course_id: courseId, weekday: slot.weekday,
      starts_at: slot.starts_at.slice(0, 5), ends_at: slot.ends_at.slice(0, 5),
      location, created_at: previous?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString() }];
  });
  const removedIds = existing.filter((meeting) => !wanted.has(key(meeting))).map((meeting) => meeting.id);
  if (changes.length) {
    const { error } = await context.supabase.from("planner_course_meetings")
      .upsert(changes, { onConflict: "id" });
    if (error) {
      console.error("Could not save planner meetings:", error);
      return { error: "Could not save the class schedule. Check for duplicate slots and try again." };
    }
  }
  if (removedIds.length) {
    const { data, error } = await context.supabase.from("planner_course_meetings")
      .delete().in("id", removedIds).eq("planner_course_id", courseId)
      .eq("user_id", context.userId).select("id");
    if (error || data?.length !== removedIds.length) {
      if (error) console.error("Could not remove old planner meetings:", error);
      const oldLocations = existing.filter((meeting) =>
        changes.some((change) => change.id === meeting.id)).map((meeting) => ({
          ...meeting, user_id: context.userId, semester_id: context.course.semester_id,
          planner_course_id: courseId,
        }));
      const [restore, removeNew] = await Promise.all([
        oldLocations.length ? context.supabase.from("planner_course_meetings")
          .upsert(oldLocations, { onConflict: "id" }) : Promise.resolve({ error: null }),
        addedIds.length ? context.supabase.from("planner_course_meetings")
          .delete().in("id", addedIds).eq("user_id", context.userId) : Promise.resolve({ error: null }),
      ]);
      if (restore.error || removeNew.error) console.error("Planner meeting rollback failed:", restore.error, removeNew.error);
      revalidatePath("/planner");
      return { error: "The schedule could not be fully saved. Refresh to check its current state before retrying." };
    }
  }
  const { data: saved, error: verifyError } = await context.supabase
    .from("planner_course_meetings")
    .select("weekday, starts_at, ends_at, location")
    .eq("planner_course_id", courseId).eq("semester_id", context.course.semester_id)
    .eq("user_id", context.userId);
  const expected = slots.map((slot) => `${key(slot)}:${slot.location?.trim() || ""}`).sort();
  const actual = (saved ?? []).map((slot) => `${key(slot)}:${slot.location ?? ""}`).sort();
  if (verifyError || expected.length !== actual.length
    || expected.some((value, index) => value !== actual[index])) {
    if (verifyError) console.error("Could not verify saved planner meetings:", verifyError);
    revalidatePath("/planner");
    return { error: "The saved schedule could not be verified. Refresh to check its current state." };
  }
  revalidatePath("/planner");
  return { error: null };
}

async function verifiedOccurrence(meetingId: string, originalDate: string) {
  const context = await ownedMeeting(meetingId);
  if (!context || !isDateOnly(originalDate)
    || originalDate < context.semester.start_date || originalDate > context.semester.end_date
    || weekdayOf(originalDate) !== context.meeting.weekday) return null;
  return context;
}

export async function saveMeetingException(meetingId: string, originalDate: string,
  kind: "cancelled" | "changed", change: MeetingChange | null) {
  const context = await verifiedOccurrence(meetingId, originalDate);
  if (!context) return { error: "This class meeting is unavailable." };
  if (kind !== "cancelled" && kind !== "changed") return { error: "Choose a valid change." };
  if (kind === "changed") {
    if (!change || typeof change !== "object"
      || (change.replacement_date !== null && !isDateOnly(change.replacement_date))
      || (change.replacement_starts_at !== null && !isTime(change.replacement_starts_at))
      || (change.replacement_ends_at !== null && !isTime(change.replacement_ends_at))
      || (change.replacement_starts_at === null) !== (change.replacement_ends_at === null)
      || (change.replacement_starts_at && change.replacement_ends_at
        && change.replacement_ends_at <= change.replacement_starts_at)
      || (change.replacement_location !== null
        && (typeof change.replacement_location !== "string" || change.replacement_location.length > 200))) {
      return { error: "Check the replacement date, time, and location." };
    }
    if (change.replacement_date
      && (change.replacement_date < context.semester.start_date
        || change.replacement_date > context.semester.end_date)) {
      return { error: "Move the class to a day within the semester." };
    }
    if (!change.replacement_date && !change.replacement_starts_at
      && change.replacement_location === null) return { error: "Change at least one detail." };
  }
  const { error } = await context.supabase.from("planner_meeting_exceptions")
    .upsert({ user_id: context.userId, semester_id: context.meeting.semester_id,
      meeting_id: meetingId, original_date: originalDate, kind,
      replacement_date: kind === "changed" ? change!.replacement_date : null,
      replacement_starts_at: kind === "changed" ? change!.replacement_starts_at : null,
      replacement_ends_at: kind === "changed" ? change!.replacement_ends_at : null,
      replacement_location: kind === "changed" ? change!.replacement_location : null,
      updated_at: new Date().toISOString() },
    { onConflict: "meeting_id,original_date" });
  if (error) {
    console.error("Could not save planner meeting exception:", error);
    return { error: "Could not change this class meeting. Please try again." };
  }
  revalidatePath("/planner");
  return { error: null };
}

export async function removeMeetingException(meetingId: string, originalDate: string) {
  const context = await verifiedOccurrence(meetingId, originalDate);
  if (!context) return { error: "This class meeting is unavailable." };
  const { data, error } = await context.supabase.from("planner_meeting_exceptions")
    .delete().eq("meeting_id", meetingId).eq("original_date", originalDate)
    .eq("user_id", context.userId).select("id").maybeSingle();
  if (error || !data) {
    if (error) console.error("Could not restore planner meeting:", error);
    return { error: "Could not restore the regular class meeting." };
  }
  revalidatePath("/planner");
  return { error: null };
}

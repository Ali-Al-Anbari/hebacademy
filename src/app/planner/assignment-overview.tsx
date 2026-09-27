"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Check, ExternalLink, FileText, Pencil, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { displayTime, formatCalendarDate, WEEKDAY_SHORT } from "@/lib/planner/dates";
import {
  ASSIGNMENT_TYPE_LABELS,
  type AssignmentDraft,
  type AssignmentStatus,
  type AssignmentSubtask,
  type AssignmentUrl,
  type EffectiveAssignment,
  type PlannerAssignment,
  type PlannerAssignmentAttachment,
  type PlannerAssignmentAttachmentRef,
  type PlannerAssignmentDeck,
  type PlannerAssignmentStudySchedule,
  type PlannerCourse,
  type PlannerCustomType,
  type PlannerDeck,
  type PlannerStudySchedule,
} from "@/lib/planner/types";
import { getAttachmentSignedUrlAction, toggleAssignmentStatus } from "./assignment-actions";

export function AssignmentOverview({
  assignment, draft, courses, customTypes, urls, subtasks, attachments, attachmentRefs,
  hebacademyCourses, hebacademyDecks, assignmentDecks, studySchedules, assignmentStudySchedules,
  scheduleProgress, onEdit, onClose, onSaved,
}: {
  assignment: PlannerAssignment | EffectiveAssignment;
  draft?: AssignmentDraft | null;
  courses: PlannerCourse[];
  customTypes: PlannerCustomType[];
  urls: AssignmentUrl[];
  subtasks: AssignmentSubtask[];
  attachments: PlannerAssignmentAttachment[];
  attachmentRefs: PlannerAssignmentAttachmentRef[];
  hebacademyCourses: { id: string; name: string }[];
  hebacademyDecks: PlannerDeck[];
  assignmentDecks: PlannerAssignmentDeck[];
  studySchedules: PlannerStudySchedule[];
  assignmentStudySchedules: PlannerAssignmentStudySchedule[];
  scheduleProgress: Record<string, { completed: number; total: number }>;
  onEdit: () => void;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [statusOverride, setStatusOverride] = useState<AssignmentStatus | null>(null);
  const pending = useRef(false);
  const virtual = "isVirtual" in assignment && Boolean(assignment.isVirtual);
  const sourceId = virtual ? (assignment.parent_series_id ?? assignment.id.split(":")[0]) : assignment.id;
  const course = courses.find((item) => item.id === (draft?.planner_course_id ?? assignment.planner_course_id));
  const typeKind = draft?.type_kind ?? assignment.type_kind;
  const customType = customTypes.find((item) => item.id === (draft?.custom_type_id ?? assignment.custom_type_id));
  const assignmentUrls = draft ? draft.urls :
    "urls" in assignment && assignment.urls ? assignment.urls : urls.filter((item) => item.assignment_id === sourceId);
  const assignmentSubtasks = draft ? draft.subtasks :
    "subtasks" in assignment && assignment.subtasks ? assignment.subtasks : subtasks.filter((item) => item.assignment_id === sourceId);
  const assignmentAttachments = attachmentRefs.filter((ref) => ref.assignment_id === sourceId)
    .sort((a, b) => a.position - b.position)
    .map((ref) => attachments.find((item) => item.id === ref.attachment_id))
    .filter((item): item is PlannerAssignmentAttachment => Boolean(item));
  const linkedDecks = assignmentDecks.filter((link) => link.assignment_id === sourceId)
    .map((link) => hebacademyDecks.find((deck) => deck.id === link.deck_id))
    .filter((deck): deck is PlannerDeck => Boolean(deck));
  const linkedSchedules = assignmentStudySchedules.filter((link) => link.assignment_id === sourceId)
    .map((link) => studySchedules.find((schedule) => schedule.id === link.study_schedule_id))
    .filter((schedule): schedule is PlannerStudySchedule => Boolean(schedule));
  const status = statusOverride ?? draft?.status ?? assignment.status;
  const recurring = Boolean(assignment.parent_series_id || assignment.recurrence_kind !== "none" || virtual);
  const originalDate = (assignment as EffectiveAssignment).originalOccurrenceDate ?? assignment.original_due_date;
  const recurrenceText = assignment.recurrence_kind === "every_x_weeks"
    ? `Repeats every ${assignment.recurrence_interval} weeks.`
    : assignment.recurrence_kind === "selected_weekdays"
      ? `Repeats ${assignment.recurrence_weekdays?.map((day) => WEEKDAY_SHORT[day - 1]).join(", ") ?? "on selected weekdays"}.`
      : `Repeats ${assignment.recurrence_kind}.`;

  async function toggleStatus() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const effective = assignment as EffectiveAssignment;
      const parentSeriesId = effective.seriesRootId ?? assignment.parent_series_id;
      const originalDueDate = effective.originalOccurrenceDate ?? assignment.original_due_date;
      const result = await toggleAssignmentStatus(
        assignment.id, status,
        virtual && parentSeriesId && originalDueDate ? { parentSeriesId, originalDueDate } : undefined
      );
      if (result.error) setMessage(result.error);
      else {
        setStatusOverride(result.status);
        onSaved();
      }
    } catch {
      setMessage("Could not update this assignment. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function openAttachment(attachmentId: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await getAttachmentSignedUrlAction({ assignmentId: sourceId, attachmentId });
      if (result.error || !result.signedUrl) setMessage(result.error ?? "Could not open attachment.");
      else window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setMessage("Could not open attachment. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/80 bg-[#fdf1f5] px-6 py-4">
        <div className="min-w-0">
          <DialogPrimitive.Title className="font-heading text-lg font-bold leading-snug text-ink">{draft?.title ?? assignment.title}</DialogPrimitive.Title>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {course && <><span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: course.color }} aria-hidden="true" />{course.name}<span aria-hidden="true">·</span></>}
            {typeKind === "custom" ? customType?.name ?? "Custom" : ASSIGNMENT_TYPE_LABELS[typeKind]}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit assignment" title="Edit assignment"><Pencil className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assignment drawer"><X className="size-4" /></Button>
        </div>
      </header>
      <div className="space-y-5 px-6 py-5 text-sm text-ink">
        {message && <p role="alert" className="notice-error">{message}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/80 pb-4 text-sm">
          <span><strong>Due</strong> {formatCalendarDate(draft?.due_date ?? assignment.due_date)}{(draft?.due_time ?? assignment.due_time) && ` at ${displayTime(draft?.due_time ?? assignment.due_time ?? "")}`}</span>
          {(draft?.start_date ?? assignment.start_date) && <span><strong>Starts</strong> {formatCalendarDate(draft?.start_date ?? assignment.start_date ?? "")}</span>}
          {(draft?.priority ?? assignment.priority) === "important" && <span className="font-semibold">! Important</span>}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span><strong>Status:</strong> {status === "done" ? "Done" : status === "in_progress" ? "In progress" : "Not started"}</span>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void toggleStatus()}>
            {status === "done" ? "Reopen" : "Mark complete"}
          </Button>
        </div>
        {(draft?.description ?? assignment.description) && <section className="space-y-1.5 border-t border-border/80 pt-4"><h3 className="font-semibold">Description</h3><p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{draft?.description ?? assignment.description}</p></section>}
        {assignmentSubtasks.length > 0 && <section className="space-y-2 border-t border-border/80 pt-4"><h3 className="font-semibold">Subtasks</h3><ul className="space-y-2">{assignmentSubtasks.map((task, index) => <li key={task.id ?? index} className="flex items-start gap-2"><span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-current">{task.is_done && <Check className="size-3" />}</span><span className={task.is_done ? "text-muted-foreground line-through" : ""}>{task.title}{task.due_date && <small className="ml-2 text-muted-foreground">{formatCalendarDate(task.due_date)}</small>}</span></li>)}</ul></section>}
        {assignmentUrls.length > 0 && <section className="space-y-2 border-t border-border/80 pt-4"><h3 className="font-semibold">Links</h3><ul className="space-y-1.5">{assignmentUrls.map((link, index) => <li key={link.id ?? index}><a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-ink underline underline-offset-2 break-all">{link.label || link.url}<ExternalLink className="size-3.5 shrink-0" /></a></li>)}</ul></section>}
        {assignmentAttachments.length > 0 && <section className="space-y-2 border-t border-border/80 pt-4"><h3 className="font-semibold">Attachments</h3><ul className="space-y-1">{assignmentAttachments.map((item) => <li key={item.id}><button type="button" disabled={busy} onClick={() => void openAttachment(item.id)} className="inline-flex items-center gap-2 py-1 text-left text-brand-ink underline underline-offset-2"><FileText className="size-4 shrink-0" />{item.file_name}</button></li>)}</ul></section>}
        {linkedDecks.length > 0 && <section className="space-y-2 border-t border-border/80 pt-4"><h3 className="font-semibold">Study materials</h3><ul className="divide-y divide-border/60">{linkedDecks.map((deck) => <li key={deck.id} className="flex items-center justify-between gap-2 py-2"><span>{deck.name}<small className="ml-2 text-muted-foreground">{hebacademyCourses.find((item) => item.id === deck.course_id)?.name}</small></span><Link href={`/courses/${deck.course_id}/decks/${deck.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open</Link></li>)}</ul></section>}
        {linkedSchedules.length > 0 && <section className="space-y-2 border-t border-border/80 pt-4"><h3 className="font-semibold">Study plan</h3><ul className="divide-y divide-border/60">{linkedSchedules.map((schedule) => <li key={schedule.id} className="flex items-center justify-between gap-2 py-2"><span>{schedule.name}{scheduleProgress[schedule.id] && <small className="ml-2 text-muted-foreground">{scheduleProgress[schedule.id].completed} of {scheduleProgress[schedule.id].total} reviews</small>}</span><Link href={`/study-schedules/${schedule.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open</Link></li>)}</ul></section>}
        {recurring && <section className="border-t border-border/80 pt-4 text-muted-foreground"><strong className="text-ink">Recurrence</strong><p className="mt-1">{assignment.parent_series_id || virtual ? `This occurrence of a recurring series${originalDate ? ` (originally ${formatCalendarDate(originalDate)})` : ""}.` : recurrenceText}</p></section>}
      </div>
    </>
  );
}

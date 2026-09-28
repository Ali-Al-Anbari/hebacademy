"use client";

import { useRef, useState, type FormEvent } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Pin,
  Plus,
  Presentation,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  formatShortDate,
  isDateOnly,
  isValidHttpUrl,
  weekdayOf,
} from "@/lib/planner/dates";
import {
  ASSIGNMENT_TYPE_LABELS,
  BUILTIN_ASSIGNMENT_TYPES,
  type AssignmentDraft,
  type AssignmentPriority,
  type AssignmentStatus,
  type AssignmentSubtask,
  type AssignmentSubtaskDraft,
  type AssignmentTypeKind,
  type AssignmentUrl,
  type AssignmentUrlDraft,
  type BuiltinAssignmentType,
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
  type PlannerWeeklyFocusItem,
  type RecurrenceEndKind,
  type RecurrenceKind,
  type Semester,
} from "@/lib/planner/types";
import {
  cancelOccurrenceAction,
  createCustomAssignmentType,
  deleteAssignment,
  deleteAttachmentAction,
  getAttachmentSignedUrlAction,
  materializeOccurrenceAction,
  registerAttachmentAction,
  saveAssignment,
  splitSeriesAction,
  updateEntireSeriesAction,
  validateAttachmentFile,
} from "./assignment-actions";
import { StudyMaterials } from "./study-materials";
import { AssignmentOverview } from "./assignment-overview";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  semester: Semester;
  courses: PlannerCourse[];
  customTypes: PlannerCustomType[];
  assignments?: PlannerAssignment[];
  assignment: (PlannerAssignment | EffectiveAssignment) | null;
  initialDate?: string | null;
  initialTime?: string | null;
  initialCourseId?: string | null;
  weeklyFocusItems?: PlannerWeeklyFocusItem[];
  activeWeekStart?: string;
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  attachments?: PlannerAssignmentAttachment[];
  attachmentRefs?: PlannerAssignmentAttachmentRef[];
  hebacademyCourses?: { id: string; name: string }[];
  hebacademyDecks?: PlannerDeck[];
  assignmentDecks?: PlannerAssignmentDeck[];
  studySchedules?: PlannerStudySchedule[];
  assignmentStudySchedules?: PlannerAssignmentStudySchedule[];
  scheduleProgress?: Record<string, { completed: number; total: number }>;
  onSaved: (savedId?: string, scope?: "this" | "future" | "series") => void;
  onDeleted?: () => void;
  onCustomTypeCreated: (type: PlannerCustomType) => void;
  onTogglePin?: (assignmentId: string, occurrenceDate?: string | null) => void;
};

function getAttachmentIcon(contentType: string) {
  if (contentType.startsWith("image/")) {
    return <ImageIcon className="size-4 text-emerald-600 shrink-0" />;
  }
  if (contentType === "application/pdf") {
    return <FileText className="size-4 text-rose-600 shrink-0" />;
  }
  if (
    contentType === "application/msword" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return <FileText className="size-4 text-blue-600 shrink-0" />;
  }
  if (
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    contentType === "text/csv"
  ) {
    return <FileSpreadsheet className="size-4 text-emerald-700 shrink-0" />;
  }
  if (
    contentType === "application/vnd.ms-powerpoint" ||
    contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return <Presentation className="size-4 text-amber-600 shrink-0" />;
  }
  return <Paperclip className="size-4 text-muted-foreground shrink-0" />;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssignmentDrawerForm({
  onClose,
  semester,
  courses,
  customTypes,
  assignments = [],
  assignment,
  initialDate,
  initialTime,
  initialCourseId,
  weeklyFocusItems = [],
  activeWeekStart,
  urls = [],
  subtasks = [],
  attachments = [],
  attachmentRefs = [],
  hebacademyCourses = [],
  hebacademyDecks = [],
  assignmentDecks = [],
  studySchedules = [],
  assignmentStudySchedules = [],
  scheduleProgress = {},
  onSaved,
  onDeleted,
  onCustomTypeCreated,
  onTogglePin,
  onFinishEdit,
  onReturnToOverview,
}: Omit<Props, "isOpen"> & {
  onFinishEdit: (id: string | undefined, draft: AssignmentDraft, scope: "this" | "future" | "series") => void;
  onReturnToOverview: () => void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initialDue = assignment
    ? assignment.due_date
    : initialDate && isDateOnly(initialDate)
      ? initialDate
      : semester.start_date;

  const isVirtual = Boolean(assignment && "isVirtual" in assignment && assignment.isVirtual);
  const isMaterialized = Boolean(assignment?.parent_series_id);
  const isOccurrence = isVirtual || isMaterialized;
  const seriesRootId = assignment?.parent_series_id || assignment?.id;
  const seriesRoot = assignments.find((a) => a.id === seriesRootId) || null;
  const originalOccurrenceDate =
    (assignment && "originalDueDate" in assignment && assignment.originalDueDate) ||
    assignment?.original_due_date ||
    assignment?.due_date ||
    initialDue;

  // Form fields
  const [title, setTitle] = useState(assignment?.title ?? "");
  const [courseId, setCourseId] = useState<string>(
    assignment?.planner_course_id ?? (initialCourseId !== undefined ? (initialCourseId ?? "") : (courses[0]?.id ?? ""))
  );
  const [startDate, setStartDate] = useState(assignment?.start_date ?? "");
  const [dueDate, setDueDate] = useState(initialDue);
  const [dueTime, setDueTime] = useState(
    assignment?.due_time ? assignment.due_time.slice(0, 5) : initialTime ?? ""
  );
  const [typeKind, setTypeKind] = useState<AssignmentTypeKind>(
    assignment?.type_kind ?? "homework"
  );
  const [customTypeId, setCustomTypeId] = useState<string>(
    assignment?.custom_type_id ?? ""
  );
  const [status, setStatus] = useState<AssignmentStatus>(
    assignment?.status ?? "not_started"
  );
  const [priority, setPriority] = useState<AssignmentPriority>(
    assignment?.priority ?? "normal"
  );
  const [description, setDescription] = useState(
    assignment?.description ?? ""
  );

  // Recurrence state: initialize from series root if occurrence, else assignment
  const recurrenceSource = seriesRoot || assignment;
  const [recurrenceKind, setRecurrenceKind] = useState<RecurrenceKind>(
    (recurrenceSource?.recurrence_kind as RecurrenceKind) || "none"
  );
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(
    recurrenceSource?.recurrence_interval || 1
  );
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>(() => {
    if (recurrenceSource?.recurrence_weekdays && Array.isArray(recurrenceSource.recurrence_weekdays)) {
      return recurrenceSource.recurrence_weekdays;
    }
    return [weekdayOf(initialDue)];
  });
  const [recurrenceEndKind, setRecurrenceEndKind] = useState<RecurrenceEndKind>(
    (recurrenceSource?.recurrence_end_kind as RecurrenceEndKind) || "semester_end"
  );
  const [recurrenceUntil, setRecurrenceUntil] = useState<string>(
    recurrenceSource?.recurrence_until || ""
  );

  // Choice when editing or deleting an occurrence: "this" | "future" | "series"
  const [editOccurrenceChoice, setEditOccurrenceChoice] = useState<"this" | "future" | "series">("this");
  const [deleteChoice, setDeleteChoice] = useState<"occurrence" | "series">("occurrence");

  // Relevant ID for child items (urls, subtasks, attachments)
  // For virtual occurrences, use seriesRootId. For materialized occurrences, use assignment.id.
  const relevantAssignId = isVirtual ? seriesRootId : assignment?.id;

  const [urlList, setUrlList] = useState<AssignmentUrlDraft[]>(() => {
    if (!assignment) return [];
    if ("urls" in assignment && Array.isArray(assignment.urls) && assignment.urls.length > 0) {
      return assignment.urls.map((u) => ({ id: u.id, url: u.url, label: u.label ?? "", position: u.position }));
    }
    if (!relevantAssignId) return [];
    return urls
      .filter((u) => u.assignment_id === relevantAssignId)
      .sort((a, b) => a.position - b.position)
      .map((u) => ({ id: u.id, url: u.url, label: u.label ?? "", position: u.position }));
  });

  const [subtaskList, setSubtaskList] = useState<AssignmentSubtaskDraft[]>(() => {
    if (!assignment) return [];
    if ("subtasks" in assignment && Array.isArray(assignment.subtasks) && assignment.subtasks.length > 0) {
      return assignment.subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        is_done: s.is_done,
        due_date: s.due_date ?? "",
        position: s.position,
      }));
    }
    if (!relevantAssignId) return [];
    return subtasks
      .filter((s) => s.assignment_id === relevantAssignId)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        title: s.title,
        is_done: s.is_done,
        due_date: s.due_date ?? "",
        position: s.position,
      }));
  });

  const [attachmentList, setAttachmentList] = useState<PlannerAssignmentAttachment[]>(() => {
    if (!assignment || !relevantAssignId) return [];
    const myRefs = attachmentRefs.filter((r) => r.assignment_id === relevantAssignId);
    const list: PlannerAssignmentAttachment[] = [];
    for (const r of myRefs) {
      const att = attachments.find((a) => a.id === r.attachment_id);
      if (att) {
        list.push({ ...att, position: r.position });
      }
    }
    return list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  });

  const [uploadingFile, setUploadingFile] = useState<{ name: string } | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline custom type creator
  const [showNewCustomType, setShowNewCustomType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [customTypeBusy, setCustomTypeBusy] = useState(false);

  async function handleCreateCustomType() {
    if (!newTypeName.trim() || customTypeBusy) return;
    setCustomTypeBusy(true);
    setMessage("");
    try {
      const result = await createCustomAssignmentType(newTypeName);
      if (result.error || !result.customType) {
        setMessage(result.error ?? "Could not create custom type.");
      } else {
        onCustomTypeCreated(result.customType);
        setTypeKind("custom");
        setCustomTypeId(result.customType.id);
        setShowNewCustomType(false);
        setNewTypeName("");
      }
    } catch {
      setMessage("Could not create custom type.");
    } finally {
      setCustomTypeBusy(false);
    }
  }

  function handleCheckboxToggle() {
    setStatus((prev) => (prev === "done" ? "not_started" : "done"));
  }

  function addUrl() {
    setUrlList((prev) => [...prev, { url: "", label: "", position: prev.length }]);
  }

  function updateUrl(index: number, patch: Partial<AssignmentUrlDraft>) {
    setUrlList((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  function removeUrl(index: number) {
    setUrlList((prev) =>
      prev.filter((_, idx) => idx !== index).map((item, idx) => ({ ...item, position: idx }))
    );
  }

  function moveUrl(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= urlList.length) return;
    setUrlList((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy.map((item, idx) => ({ ...item, position: idx }));
    });
  }

  function addSubtask() {
    setSubtaskList((prev) => [
      ...prev,
      { title: "", is_done: false, due_date: "", position: prev.length },
    ]);
  }

  function updateSubtask(index: number, patch: Partial<AssignmentSubtaskDraft>) {
    setSubtaskList((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  function removeSubtask(index: number) {
    setSubtaskList((prev) =>
      prev.filter((_, idx) => idx !== index).map((item, idx) => ({ ...item, position: idx }))
    );
  }

  function moveSubtask(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= subtaskList.length) return;
    setSubtaskList((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy.map((item, idx) => ({ ...item, position: idx }));
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (file.size <= 0) {
      setMessage("File cannot be empty.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage("File exceeds the 20 MB size limit.");
      return;
    }

    const clientVal = await validateAttachmentFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (clientVal.error || !clientVal.canonicalMime) {
      setMessage(clientVal.error || "Unsupported file type. Allowed: PDF, images, Word, PowerPoint, Excel, CSV.");
      return;
    }

    let effectiveAssignmentId = assignment?.id;
    if (isVirtual && seriesRootId && originalOccurrenceDate) {
      setBusy(true);
      const matRes = await materializeOccurrenceAction({
        seriesId: seriesRootId,
        originalDueDate: originalOccurrenceDate,
        updates: {
          title: title.trim(),
          due_date: dueDate,
          start_date: startDate || null,
          due_time: dueTime ? dueTime.slice(0, 5) : null,
          planner_course_id: courseId || null,
          type_kind: typeKind,
          custom_type_id: typeKind === "custom" ? customTypeId || null : null,
          status,
          priority,
          description: description.trim() || null,
        },
      });
      if (matRes.error || !matRes.id) {
        setMessage(matRes.error || "Could not materialize occurrence for attachment.");
        setBusy(false);
        return;
      }
      effectiveAssignmentId = matRes.id;
    }

    if (!effectiveAssignmentId) {
      setMessage("Please save the assignment first before uploading attachments.");
      return;
    }

    setUploadingFile({ name: file.name });
    setMessage("");

    let regRes: Awaited<ReturnType<typeof registerAttachmentAction>>;
    try {
      regRes = await registerAttachmentAction({
        assignmentId: effectiveAssignmentId,
        fileName: file.name,
        contentType: clientVal.canonicalMime,
        byteSize: file.size,
      });
    } catch {
      setMessage("Could not register attachment. Please try again.");
      setUploadingFile(null);
      setBusy(false);
      return;
    }

    if (regRes.error || !regRes.data) {
      setMessage(regRes.error || "Failed to register attachment.");
      setUploadingFile(null);
      setBusy(false);
      return;
    }

    const registered = regRes.data;

    try {
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("planner-attachments")
        .upload(registered.storage_path, file, {
          contentType: registered.content_type,
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        await deleteAttachmentAction({
          assignmentId: effectiveAssignmentId,
          attachmentId: registered.id,
        });
        setMessage(`Upload failed: ${uploadError.message}. Please try again.`);
        setUploadingFile(null);
        setBusy(false);
        return;
      }

      const newAtt: PlannerAssignmentAttachment = {
        id: registered.id,
        semester_id: registered.semester_id,
        assignment_id: registered.assignment_id,
        storage_path: registered.storage_path,
        file_name: registered.file_name,
        content_type: registered.content_type,
        byte_size: registered.byte_size,
        position: registered.position,
        created_at: new Date().toISOString(),
      };
      setAttachmentList((prev) => [...prev, newAtt]);
      onSaved(effectiveAssignmentId);
    } catch (err: unknown) {
      console.error("Attachment upload exception:", err);
      await deleteAttachmentAction({
        assignmentId: effectiveAssignmentId,
        attachmentId: registered.id,
      });
      setMessage("Failed to upload file. Please try again.");
    } finally {
      setUploadingFile(null);
      setBusy(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    if (!assignment || !relevantAssignId) return;
    const targetId = relevantAssignId;
    setBusy(true);
    setMessage("");
    try {
      const res = await deleteAttachmentAction({
        assignmentId: targetId,
        attachmentId,
      });
      if (res.error) {
        setMessage(res.error);
      } else {
        setAttachmentList((prev) => prev.filter((a) => a.id !== attachmentId));
        onSaved(targetId);
      }
    } catch {
      setMessage("Could not remove attachment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenAttachment(attachmentId: string) {
    if (!assignment || !relevantAssignId) return;
    setOpeningAttachmentId(attachmentId);
    try {
      const res = await getAttachmentSignedUrlAction({
        assignmentId: relevantAssignId,
        attachmentId,
      });
      if (res.error || !res.signedUrl) {
        setMessage(res.error || "Could not open attachment.");
      } else {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setMessage("Could not access attachment. Please try again.");
    } finally {
      setOpeningAttachmentId(null);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;

    if (!title.trim()) {
      setMessage("Please enter an assignment title.");
      return;
    }
    if (!dueDate) {
      setMessage("Please select a due date.");
      return;
    }
    if (startDate && startDate > dueDate) {
      setMessage("Start date cannot be after the due date.");
      return;
    }
    if (typeKind === "custom" && !customTypeId) {
      setMessage("Please select or create a custom assignment type.");
      return;
    }

    for (const [idx, link] of urlList.entries()) {
      if (!link.url.trim() || !isValidHttpUrl(link.url)) {
        setMessage(`Link #${idx + 1} must start with http:// or https://.`);
        return;
      }
    }

    for (const [idx, task] of subtaskList.entries()) {
      if (!task.title.trim()) {
        setMessage(`Subtask #${idx + 1} must have a title.`);
        return;
      }
    }

    // Determine recurrence fields based on occurrence choice
    let recKind: RecurrenceKind = "none";
    let recInterval = 1;
    let recWeekdays: number[] | null = null;
    let recEndKind: RecurrenceEndKind = "none";
    let recUntil: string | null = null;

    if (isOccurrence) {
      if (editOccurrenceChoice === "this") {
        recKind = "none";
        recInterval = 1;
        recWeekdays = null;
        recEndKind = "none";
        recUntil = null;
      } else {
        recKind = recurrenceKind;
        recInterval = recurrenceInterval;
        recWeekdays = recurrenceKind === "selected_weekdays" ? recurrenceWeekdays : null;
        recEndKind = recurrenceEndKind;
        recUntil = recurrenceEndKind === "date" ? recurrenceUntil || null : null;
      }
    } else {
      recKind = recurrenceKind;
      recInterval = recurrenceInterval;
      recWeekdays = recurrenceKind === "selected_weekdays" ? recurrenceWeekdays : null;
      recEndKind = recurrenceEndKind;
      recUntil = recurrenceEndKind === "date" ? recurrenceUntil || null : null;
    }

    const payload: AssignmentDraft = {
      title: title.trim(),
      planner_course_id: courseId || null,
      start_date: startDate || null,
      due_date: dueDate,
      due_time: dueTime ? dueTime.slice(0, 5) : null,
      type_kind: typeKind,
      custom_type_id: typeKind === "custom" ? customTypeId || null : null,
      status,
      priority,
      description: description.trim() || null,
      recurrence_kind: recKind,
      recurrence_interval: recInterval,
      recurrence_weekdays: recWeekdays,
      recurrence_end_kind: recEndKind,
      recurrence_until: recUntil,
      urls: urlList.map((u, idx) => ({ ...u, position: idx })),
      subtasks: subtaskList.map((s, idx) => ({ ...s, position: idx })),
    };

    inFlight.current = true;
    setBusy(true);
    setMessage("");

    try {
      if (isOccurrence && seriesRootId) {
        if (editOccurrenceChoice === "series") {
          const res = await updateEntireSeriesAction({
            seriesId: seriesRootId,
            semesterId: semester.id,
            updates: payload,
          });
          if (res.error) {
            setMessage(res.error);
          } else {
            onFinishEdit(res.id ?? undefined, payload, "series");
          }
        } else if (editOccurrenceChoice === "future") {
          const res = await splitSeriesAction({
            seriesId: seriesRootId,
            splitDate: originalOccurrenceDate,
            updates: payload,
          });
          if (res.error) {
            setMessage(res.error);
          } else {
            onFinishEdit(res.id ?? undefined, payload, "future");
          }
        } else {
          const res = await materializeOccurrenceAction({
            seriesId: seriesRootId,
            originalDueDate: originalOccurrenceDate,
            updates: payload,
          });
          if (res.error) {
            setMessage(res.error);
          } else {
            onFinishEdit(res.id ?? undefined, payload, "this");
          }
        }
      } else {
        const res = await saveAssignment(assignment?.id ?? null, semester.id, payload);
        if (res.error) {
          setMessage(res.error);
        } else {
          onFinishEdit(res.id ?? undefined, payload, "this");
        }
      }
    } catch {
      setMessage("Could not save the assignment. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleDelete() {
    if ((!assignment && !seriesRootId) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");

    try {
      if (isOccurrence && seriesRootId) {
        if (deleteChoice === "occurrence") {
          const res = await cancelOccurrenceAction({
            seriesId: seriesRootId,
            originalDueDate: originalOccurrenceDate,
          });
          if (res.error) {
            setMessage(res.error);
            return;
          }
        } else {
          const res = await deleteAssignment(seriesRootId);
          if (res.error) {
            setMessage(res.error);
            return;
          }
        }
      } else if (assignment) {
        const res = await deleteAssignment(assignment.id);
        if (res.error) {
          setMessage(res.error);
          return;
        }
      }
      setConfirmDelete(false);
      if (onDeleted) onDeleted();
      else onSaved();
      onClose();
    } catch {
      setMessage("Could not delete. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const selectedCourse = courses.find((c) => c.id === courseId);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/80 px-6 py-4.5 bg-[#fdf1f5]/60 sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCheckboxToggle}
            disabled={busy}
            className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
              status === "done"
                ? "border-brand-ink bg-brand-ink text-white"
                : "border-border hover:border-brand-ink bg-white"
            }`}
            aria-label={status === "done" ? "Mark assignment not started" : "Mark assignment done"}
          >
            {status === "done" && <Check className="size-4 stroke-[3]" />}
          </button>
          <div>
            <DialogPrimitive.Title className="font-heading text-lg font-bold text-ink">
              {assignment ? "Edit Assignment" : "New Assignment"}
            </DialogPrimitive.Title>
            <p className="text-xs text-muted-foreground">{semester.name}</p>
          </div>
        </div>
        <DialogPrimitive.Close
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="Close assignment drawer"
            />
          }
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 space-y-5 p-6">
        {message && (
          <div role="alert" className="notice-error text-sm flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="assignment-title" className="text-sm font-semibold">
            Title <span className="text-brand-ink">*</span>
          </Label>
          <Input
            id="assignment-title"
            required
            maxLength={200}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Ocular Pathology Lab Report 3"
            className={status === "done" ? "line-through text-muted-foreground" : ""}
          />
        </div>

        {/* Course Selection */}
        <div className="space-y-1.5">
          <Label htmlFor="assignment-course" className="text-sm font-semibold">
            Class
          </Label>
          <div className="relative flex items-center">
            {selectedCourse && (
              <span
                className="absolute left-3 size-3 rounded-full border border-foreground/20"
                style={{ backgroundColor: selectedCourse.color }}
                aria-hidden="true"
              />
            )}
            <select
              id="assignment-course"
              value={courseId}
              disabled={busy}
              onChange={(e) => setCourseId(e.target.value)}
              className={`h-10 w-full rounded-lg border border-input bg-white text-sm outline-none transition-all focus:border-brand-ink focus:ring-2 focus:ring-brand-50 ${
                selectedCourse ? "pl-8 pr-3" : "px-3"
              }`}
            >
              <option value="">No class (Independent)</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dates & Times */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="assignment-due-date" className="text-sm font-semibold flex items-center gap-1">
              <Calendar className="size-3.5 text-muted-foreground" />
              Due Date <span className="text-brand-ink">*</span>
            </Label>
            <Input
              id="assignment-due-date"
              type="date"
              required
              value={dueDate}
              disabled={busy}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignment-start-date" className="text-sm font-semibold flex items-center gap-1">
              <Calendar className="size-3.5 text-muted-foreground" />
              Start Date <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
            </Label>
            <Input
              id="assignment-start-date"
              type="date"
              value={startDate}
              max={dueDate || undefined}
              disabled={busy}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignment-due-time" className="text-sm font-semibold flex items-center gap-1">
              <Clock className="size-3.5 text-muted-foreground" />
              Due Time <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
            </Label>
            <Input
              id="assignment-due-time"
              type="time"
              value={dueTime}
              disabled={busy}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
        </div>
        {startDate && dueDate && startDate > dueDate && (
          <p className="text-xs text-destructive">Start date must be on or before the due date.</p>
        )}

        {/* Recurrence Settings or Occurrence Banner */}
        {isOccurrence && (
          <div className="rounded-xl border border-brand-200/80 bg-brand-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-brand-200 text-xs font-bold text-brand-ink">
                ↻
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-brand-ink">
                  Recurring Occurrence
                </p>
                <p className="text-xs text-muted-foreground">
                  Scheduled for {formatShortDate(originalOccurrenceDate)}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-brand-200/60">
              <p className="text-xs font-semibold text-foreground">Apply changes to:</p>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="editOccurrenceChoice"
                    value="this"
                    checked={editOccurrenceChoice === "this"}
                    onChange={() => setEditOccurrenceChoice("this")}
                    className="accent-brand-ink"
                  />
                  <span>This occurrence only</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="editOccurrenceChoice"
                    value="future"
                    checked={editOccurrenceChoice === "future"}
                    onChange={() => setEditOccurrenceChoice("future")}
                    className="accent-brand-ink"
                  />
                  <span>This and all future occurrences (split series)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="editOccurrenceChoice"
                    value="series"
                    checked={editOccurrenceChoice === "series"}
                    onChange={() => setEditOccurrenceChoice("series")}
                    className="accent-brand-ink"
                  />
                  <span>Entire series</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {(!isOccurrence || editOccurrenceChoice !== "this") && (
          <div className="space-y-3 rounded-xl border border-border/80 bg-white/70 p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="assignment-repeat" className="text-sm font-semibold flex items-center gap-1.5">
                <span>Repeat</span>
              </Label>
              <select
                id="assignment-repeat"
                value={recurrenceKind}
                disabled={busy}
                onChange={(e) => setRecurrenceKind(e.target.value as RecurrenceKind)}
                className="h-8 rounded-md border border-input bg-white px-2.5 text-xs font-medium outline-none focus:border-brand-ink"
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="selected_weekdays">Selected weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="every_x_weeks">Every X weeks</option>
                <option value="monthly">Monthly (same day number)</option>
              </select>
            </div>

            {recurrenceKind === "selected_weekdays" && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-muted-foreground">Select repeating days:</p>
                <div className="flex gap-1">
                  {[
                    { day: 1, label: "Mon" },
                    { day: 2, label: "Tue" },
                    { day: 3, label: "Wed" },
                    { day: 4, label: "Thu" },
                    { day: 5, label: "Fri" },
                    { day: 6, label: "Sat" },
                    { day: 7, label: "Sun" },
                  ].map(({ day, label }) => {
                    const isSelected = recurrenceWeekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            if (recurrenceWeekdays.length > 1) {
                              setRecurrenceWeekdays(recurrenceWeekdays.filter((w) => w !== day));
                            }
                          } else {
                            setRecurrenceWeekdays([...recurrenceWeekdays, day].sort((a, b) => a - b));
                          }
                        }}
                        className={`flex-1 h-8 rounded text-xs font-semibold transition-all ${
                          isSelected
                            ? "bg-brand-ink text-white"
                            : "bg-[#f7edf1] text-foreground hover:bg-[#f2e1e7]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {recurrenceKind === "every_x_weeks" && (
              <div className="flex items-center gap-2 pt-1 text-xs">
                <span>Repeat every</span>
                <Input
                  type="number"
                  min={1}
                  max={52}
                  value={recurrenceInterval}
                  disabled={busy}
                  onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value)))}
                  className="w-16 h-8 text-xs font-medium"
                />
                <span>weeks</span>
              </div>
            )}

            {recurrenceKind !== "none" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                <div className="space-y-1">
                  <Label htmlFor="recurrence-end-kind" className="text-xs font-semibold">
                    Ends
                  </Label>
                  <select
                    id="recurrence-end-kind"
                    value={recurrenceEndKind}
                    disabled={busy}
                    onChange={(e) => setRecurrenceEndKind(e.target.value as RecurrenceEndKind)}
                    className="h-8 w-full rounded-md border border-input bg-white px-2.5 text-xs font-medium outline-none focus:border-brand-ink"
                  >
                    <option value="semester_end">At semester end ({formatShortDate(semester.end_date)})</option>
                    <option value="date">On specific date</option>
                    <option value="never">Never</option>
                  </select>
                </div>

                {recurrenceEndKind === "date" && (
                  <div className="space-y-1">
                    <Label htmlFor="recurrence-until" className="text-xs font-semibold">
                      End date
                    </Label>
                    <Input
                      id="recurrence-until"
                      type="date"
                      min={dueDate}
                      value={recurrenceUntil}
                      disabled={busy}
                      onChange={(e) => setRecurrenceUntil(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Assignment Type & Custom Type */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="assignment-type" className="text-sm font-semibold">
              Type
            </Label>
            {!showNewCustomType && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowNewCustomType(true)}
                className="text-xs font-semibold text-brand-ink hover:underline"
              >
                + Create custom type
              </button>
            )}
          </div>

          {showNewCustomType ? (
            <div className="rounded-lg border border-border/70 bg-white p-3 space-y-2">
              <p className="text-xs font-semibold text-ink">Add a new custom assignment type</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Case Presentation"
                  value={newTypeName}
                  maxLength={60}
                  disabled={customTypeBusy}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={customTypeBusy || !newTypeName.trim()}
                  onClick={handleCreateCustomType}
                >
                  {customTypeBusy ? "Adding…" : "Add"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={customTypeBusy}
                  onClick={() => {
                    setShowNewCustomType(false);
                    setNewTypeName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                id="assignment-type"
                value={typeKind}
                disabled={busy}
                onChange={(e) => {
                  const val = e.target.value as AssignmentTypeKind;
                  setTypeKind(val);
                  if (val === "custom" && !customTypeId && customTypes.length > 0) {
                    setCustomTypeId(customTypes[0].id);
                  }
                }}
                className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none transition-all focus:border-brand-ink focus:ring-2 focus:ring-brand-50"
              >
                <optgroup label="Standard Types">
                  {BUILTIN_ASSIGNMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ASSIGNMENT_TYPE_LABELS[type as BuiltinAssignmentType]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Custom">
                  <option value="custom">Custom…</option>
                </optgroup>
              </select>

              {typeKind === "custom" && (
                <select
                  id="assignment-custom-type"
                  value={customTypeId}
                  disabled={busy}
                  onChange={(e) => setCustomTypeId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none transition-all focus:border-brand-ink focus:ring-2 focus:ring-brand-50"
                >
                  <option value="">Select custom type</option>
                  {customTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Status and Priority */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="assignment-status" className="text-sm font-semibold">
              Status
            </Label>
            <select
              id="assignment-status"
              value={status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
              className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none transition-all focus:border-brand-ink focus:ring-2 focus:ring-brand-50"
            >
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Priority</Label>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPriority((prev) => (prev === "important" ? "normal" : "important"))}
              className={`flex h-10 w-full items-center justify-between rounded-lg border px-3 text-sm font-medium transition-all ${
                priority === "important"
                  ? "border-red-400 bg-red-50 text-red-900"
                  : "border-input bg-white text-ink hover:bg-brand-50"
              }`}
            >
              <span>{priority === "important" ? "Important" : "Normal"}</span>
              {priority === "important" ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-red-600 font-bold text-xs text-white">
                  !
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Click to mark important</span>
              )}
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="assignment-description" className="text-sm font-semibold">
            Description / Notes <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
          </Label>
          <Textarea
            id="assignment-description"
            rows={3}
            maxLength={3000}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes, prompt requirements, reading pages, or deliverables..."
          />
        </div>

        {/* Subtasks */}
        <div className="space-y-2 border-t border-border/80 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Subtasks</h3>
              <p className="text-xs text-muted-foreground">
                {subtaskList.filter((s) => s.is_done).length} of {subtaskList.length} completed
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={addSubtask}
              className="h-8 gap-1 text-xs"
            >
              <Plus className="size-3.5" />
              Add subtask
            </Button>
          </div>

          {subtaskList.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No subtasks added yet.</p>
          ) : (
            <ul className="space-y-2">
              {subtaskList.map((task, idx) => (
                <li
                  key={idx}
                  className="flex flex-col gap-2 rounded-lg border border-border/70 bg-white p-2.5 sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={task.is_done}
                      disabled={busy}
                      onChange={(e) => updateSubtask(idx, { is_done: e.target.checked })}
                      className="size-4 rounded border-input text-brand-ink accent-brand-ink cursor-pointer"
                      aria-label={`Toggle subtask "${task.title || `Subtask ${idx + 1}`}"`}
                    />
                    <Input
                      value={task.title}
                      maxLength={200}
                      placeholder="Subtask title"
                      disabled={busy}
                      onChange={(e) => updateSubtask(idx, { title: e.target.value })}
                      className={`h-8 flex-1 text-sm ${task.is_done ? "line-through text-muted-foreground" : ""}`}
                    />
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <Input
                      type="date"
                      value={task.due_date ?? ""}
                      disabled={busy}
                      title="Subtask due date (optional)"
                      onChange={(e) => updateSubtask(idx, { due_date: e.target.value || null })}
                      className="h-8 w-34 text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || idx === 0}
                      onClick={() => moveSubtask(idx, "up")}
                      title="Move up"
                      aria-label="Move subtask up"
                      className="size-8"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || idx === subtaskList.length - 1}
                      onClick={() => moveSubtask(idx, "down")}
                      title="Move down"
                      aria-label="Move subtask down"
                      className="size-8"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => removeSubtask(idx)}
                      title="Remove subtask"
                      aria-label="Remove subtask"
                      className="size-8 text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* URLs / Links */}
        <div className="space-y-2 border-t border-border/80 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Links & Resources</h3>
              <p className="text-xs text-muted-foreground">Canvas, Google Docs, lecture notes, etc.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={addUrl}
              className="h-8 gap-1 text-xs"
            >
              <Plus className="size-3.5" />
              Add link
            </Button>
          </div>

          {urlList.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No links added yet.</p>
          ) : (
            <ul className="space-y-2">
              {urlList.map((link, idx) => (
                <li
                  key={idx}
                  className="flex flex-col gap-2 rounded-lg border border-border/70 bg-white p-2.5 sm:flex-row sm:items-center"
                >
                  <Input
                    placeholder="Label (e.g. Canvas page)"
                    value={link.label ?? ""}
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => updateUrl(idx, { label: e.target.value })}
                    className="h-8 sm:w-36 text-sm"
                  />
                  <Input
                    placeholder="https://..."
                    value={link.url}
                    type="url"
                    required
                    disabled={busy}
                    onChange={(e) => updateUrl(idx, { url: e.target.value })}
                    className="h-8 flex-1 text-sm font-mono"
                  />
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    {isValidHttpUrl(link.url) && (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-brand-50 hover:text-ink"
                        title="Open link in new tab"
                        aria-label={`Open link ${link.label || link.url} in new tab`}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || idx === 0}
                      onClick={() => moveUrl(idx, "up")}
                      title="Move up"
                      aria-label="Move link up"
                      className="size-8"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || idx === urlList.length - 1}
                      onClick={() => moveUrl(idx, "down")}
                      title="Move down"
                      aria-label="Move link down"
                      className="size-8"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => removeUrl(idx)}
                      title="Remove link"
                      aria-label="Remove link"
                      className="size-8 text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {assignment && seriesRootId && (
          <StudyMaterials
            assignment={assignment}
            rootId={seriesRootId}
            occurrenceDate={originalOccurrenceDate}
            isVirtual={isVirtual}
            isOccurrence={isOccurrence}
            plannerCourse={courses.find((course) => course.id === assignment.planner_course_id)}
            courses={hebacademyCourses}
            decks={hebacademyDecks}
            deckLinks={assignmentDecks}
            schedules={studySchedules}
            scheduleLinks={assignmentStudySchedules}
            scheduleProgress={scheduleProgress}
            onSaved={() => { onSaved(); onReturnToOverview(); }}
          />
        )}

        {/* Attachments */}
        <div className="space-y-2 border-t border-border/80 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Attachments {attachmentList.length > 0 && `(${attachmentList.length})`}
              </h3>
              <p className="text-xs text-muted-foreground">PDF, images, Word, PowerPoint, Excel, CSV up to 20 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileSelect}
              disabled={busy || !assignment}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !assignment}
              onClick={() => fileInputRef.current?.click()}
              className="h-8 gap-1 text-xs"
              title={!assignment ? "Save assignment first to attach files" : undefined}
            >
              <Plus className="size-3.5" />
              Add file
            </Button>
          </div>

          {!assignment && (
            <p className="py-2 text-xs text-muted-foreground italic">
              Save this assignment first to attach files.
            </p>
          )}

          {uploadingFile && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200/80 bg-brand-50/50 p-2.5 text-xs text-brand-ink">
              <Loader2 className="size-4 animate-spin shrink-0 text-brand-ink" />
              <span className="truncate">Uploading {uploadingFile.name}…</span>
            </div>
          )}

          {assignment && attachmentList.length === 0 && !uploadingFile && (
            <p className="py-2 text-xs text-muted-foreground">No attachments added yet.</p>
          )}

          {attachmentList.length > 0 && (
            <ul className="space-y-2">
              {attachmentList.map((att) => (
                <li
                  key={att.id}
                  className="flex items-center justify-between gap-2.5 rounded-lg border border-border/70 bg-white p-2.5 text-xs shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {getAttachmentIcon(att.content_type)}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink truncate" title={att.file_name}>
                        {att.file_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatFileSize(att.byte_size)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || openingAttachmentId === att.id}
                      onClick={() => handleOpenAttachment(att.id)}
                      title="Open or download file"
                      aria-label={`Open or download ${att.file_name}`}
                      className="size-8 text-muted-foreground hover:text-ink"
                    >
                      {openingAttachmentId === att.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => handleDeleteAttachment(att.id)}
                      title="Remove attachment from this assignment"
                      aria-label={`Remove ${att.file_name}`}
                      className="size-8 text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Weekly Focus Pinning (for existing assignment) */}
        {assignment && onTogglePin && activeWeekStart && (
          (() => {
            const isPinned = weeklyFocusItems.some((w) => {
              if (w.week_start !== activeWeekStart) return false;
              if (isVirtual) {
                return w.assignment_id === seriesRootId && w.occurrence_date === originalOccurrenceDate;
              }
              return w.assignment_id === assignment.id;
            });
            return (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[#ebd5dd] bg-white p-3 text-xs shadow-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                    isPinned ? "bg-brand-ink/10 text-brand-ink" : "bg-[#fbf0f4] text-muted-foreground"
                  }`}>
                    <Pin className={`size-3.5 ${isPinned ? "fill-brand-ink" : ""}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">
                      {isPinned ? "Pinned in Weekly Focus" : "Pin to Weekly Focus"}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {isPinned
                        ? `Included in your Weekly Focus for week of ${formatShortDate(activeWeekStart)}.`
                        : `Add to this week's checklist (${formatShortDate(activeWeekStart)}).`}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant={isPinned ? "outline" : "secondary"}
                  size="sm"
                  className="h-7 text-xs font-semibold shrink-0"
                  onClick={() => onTogglePin(assignment.id, isVirtual ? originalOccurrenceDate : null)}
                >
                  {isPinned ? "Remove pin" : "Pin to focus"}
                </Button>
              </div>
            );
          })()
        )}

        {/* Actions Footer */}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-col gap-2 border-t border-border/80 bg-[#fdf1f5]/90 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          {assignment || isOccurrence ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              {isOccurrence ? "Cancel / Delete…" : "Delete assignment"}
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? "Saving…"
                : isOccurrence
                ? editOccurrenceChoice === "series"
                  ? "Save entire series"
                  : editOccurrenceChoice === "future"
                  ? "Save this & future"
                  : "Save this occurrence"
                : assignment
                ? "Save changes"
                : "Create assignment"}
            </Button>
          </div>
        </div>
      </form>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!busy) setConfirmDelete(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOccurrence ? "Cancel occurrence or delete series?" : "Delete assignment permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOccurrence
                ? "This assignment is part of a recurring series. Choose how you would like to proceed:"
                : `“${title || assignment?.title}” and all its subtasks and links will be permanently deleted. This cannot be undone.`}
            </AlertDialogDescription>
            {isOccurrence && (
              <div className="space-y-2 pt-1 text-ink text-sm">
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-border/80 p-2.5 hover:bg-black/5">
                  <input
                    type="radio"
                    name="deleteOccurrenceChoice"
                    value="occurrence"
                    checked={deleteChoice === "occurrence"}
                    onChange={() => setDeleteChoice("occurrence")}
                    className="mt-0.5 text-brand-ink"
                  />
                  <div>
                    <span className="font-medium text-ink">Cancel this occurrence only</span>
                    <p className="text-xs text-muted-foreground">
                      Removes this occurrence on {originalOccurrenceDate}. Future occurrences will remain.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-border/80 p-2.5 hover:bg-black/5">
                  <input
                    type="radio"
                    name="deleteOccurrenceChoice"
                    value="series"
                    checked={deleteChoice === "series"}
                    onChange={() => setDeleteChoice("series")}
                    className="mt-0.5 text-brand-ink"
                  />
                  <div>
                    <span className="font-medium text-destructive">Delete entire recurring series</span>
                    <p className="text-xs text-muted-foreground">
                      Permanently deletes the root recurring assignment and all occurrences.
                    </p>
                  </div>
                </label>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {busy
                ? "Processing…"
                : isOccurrence
                ? deleteChoice === "occurrence"
                  ? "Cancel occurrence"
                  : "Delete entire series"
                : "Delete assignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AssignmentDrawer(props: Props) {
  const [mode, setMode] = useState<"overview" | "edit">(props.assignment ? "overview" : "edit");
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);

  function close() {
    setMode("overview");
    setDraft(null);
    props.onClose();
  }

  function finishEdit(id: string | undefined, updated: AssignmentDraft, scope: "this" | "future" | "series") {
    if (!props.assignment) {
      props.onSaved(id);
      close();
      return;
    }
    setDraft(scope === "series" && props.assignment.parent_series_id ? null : updated);
    setMode("overview");
    props.onSaved(id, scope);
  }

  return (
    <DialogPrimitive.Root open={props.isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-40 bg-[#261820]/30 backdrop-blur-[1px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-[#fff9fb] text-popover-foreground shadow-[-12px_0_40px_#23182025] outline-none overflow-y-auto sm:max-w-xl duration-200 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
        >
          {props.isOpen && props.assignment && mode === "overview" && (
            <AssignmentOverview
              assignment={props.assignment}
              assignments={props.assignments ?? []}
              draft={draft}
              courses={props.courses}
              customTypes={props.customTypes}
              urls={props.urls ?? []}
              subtasks={props.subtasks ?? []}
              attachments={props.attachments ?? []}
              attachmentRefs={props.attachmentRefs ?? []}
              hebacademyCourses={props.hebacademyCourses ?? []}
              hebacademyDecks={props.hebacademyDecks ?? []}
              assignmentDecks={props.assignmentDecks ?? []}
              studySchedules={props.studySchedules ?? []}
              assignmentStudySchedules={props.assignmentStudySchedules ?? []}
              scheduleProgress={props.scheduleProgress ?? {}}
              onEdit={() => { setDraft(null); setMode("edit"); }}
              onClose={close}
              onSaved={props.onSaved}
            />
          )}
          {props.isOpen && mode === "edit" && (
            <AssignmentDrawerForm
              key={
                props.assignment
                  ? props.assignment.id
                  : `new:${props.initialDate ?? "default"}:${props.initialCourseId ?? "default"}`
              }
              onClose={close}
              semester={props.semester}
              courses={props.courses}
              customTypes={props.customTypes}
              assignments={props.assignments}
              assignment={props.assignment}
              initialDate={props.initialDate}
              initialTime={props.initialTime}
              initialCourseId={props.initialCourseId}
              weeklyFocusItems={props.weeklyFocusItems}
              activeWeekStart={props.activeWeekStart}
              urls={props.urls}
              subtasks={props.subtasks}
              attachments={props.attachments}
              attachmentRefs={props.attachmentRefs}
              hebacademyCourses={props.hebacademyCourses}
              hebacademyDecks={props.hebacademyDecks}
              assignmentDecks={props.assignmentDecks}
              studySchedules={props.studySchedules}
              assignmentStudySchedules={props.assignmentStudySchedules}
              scheduleProgress={props.scheduleProgress}
              onSaved={props.onSaved}
              onDeleted={props.onDeleted}
              onCustomTypeCreated={props.onCustomTypeCreated}
              onTogglePin={props.onTogglePin}
              onFinishEdit={finishEdit}
              onReturnToOverview={() => setMode("overview")}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

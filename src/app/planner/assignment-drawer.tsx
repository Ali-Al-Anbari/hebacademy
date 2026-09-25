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
  Pin,
  Plus,
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
import { formatShortDate, isDateOnly, isValidHttpUrl } from "@/lib/planner/dates";
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
  type PlannerAssignment,
  type PlannerCourse,
  type PlannerCustomType,
  type PlannerWeeklyFocusItem,
  type Semester,
} from "@/lib/planner/types";
import {
  createCustomAssignmentType,
  deleteAssignment,
  saveAssignment,
} from "./assignment-actions";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  semester: Semester;
  courses: PlannerCourse[];
  customTypes: PlannerCustomType[];
  assignment: PlannerAssignment | null;
  initialDate?: string | null;
  initialCourseId?: string | null;
  weeklyFocusItems?: PlannerWeeklyFocusItem[];
  activeWeekStart?: string;
  urls?: AssignmentUrl[];
  subtasks?: AssignmentSubtask[];
  onSaved: (savedId?: string) => void;
  onDeleted?: () => void;
  onCustomTypeCreated: (type: PlannerCustomType) => void;
  onTogglePin?: (assignmentId: string) => void;
};

function AssignmentDrawerForm({
  onClose,
  semester,
  courses,
  customTypes,
  assignment,
  initialDate,
  initialCourseId,
  weeklyFocusItems = [],
  activeWeekStart,
  urls = [],
  subtasks = [],
  onSaved,
  onDeleted,
  onCustomTypeCreated,
  onTogglePin,
}: Omit<Props, "isOpen">) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initialDue = assignment
    ? assignment.due_date
    : initialDate && isDateOnly(initialDate)
      ? initialDate
      : semester.start_date;

  // Form fields
  const [title, setTitle] = useState(assignment?.title ?? "");
  const [courseId, setCourseId] = useState<string>(
    assignment?.planner_course_id ?? (initialCourseId !== undefined ? (initialCourseId ?? "") : (courses[0]?.id ?? ""))
  );
  const [startDate, setStartDate] = useState(assignment?.start_date ?? "");
  const [dueDate, setDueDate] = useState(initialDue);
  const [dueTime, setDueTime] = useState(
    assignment?.due_time ? assignment.due_time.slice(0, 5) : ""
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

  const [urlList, setUrlList] = useState<AssignmentUrlDraft[]>(() => {
    if (!assignment) return [];
    return urls
      .filter((u) => u.assignment_id === assignment.id)
      .sort((a, b) => a.position - b.position)
      .map((u) => ({ id: u.id, url: u.url, label: u.label ?? "", position: u.position }));
  });

  const [subtaskList, setSubtaskList] = useState<AssignmentSubtaskDraft[]>(() => {
    if (!assignment) return [];
    return subtasks
      .filter((s) => s.assignment_id === assignment.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        title: s.title,
        is_done: s.is_done,
        due_date: s.due_date ?? "",
        position: s.position,
      }));
  });

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
      urls: urlList.map((u, idx) => ({ ...u, position: idx })),
      subtasks: subtaskList.map((s, idx) => ({ ...s, position: idx })),
    };

    inFlight.current = true;
    setBusy(true);
    setMessage("");

    try {
      const res = await saveAssignment(assignment?.id ?? null, semester.id, payload);
      if (res.error) {
        setMessage(res.error);
      } else {
        onSaved(res.id ?? undefined);
        onClose();
      }
    } catch {
      setMessage("Could not save the assignment. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!assignment || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");

    try {
      const res = await deleteAssignment(assignment.id);
      if (res.error) {
        setMessage(res.error);
      } else {
        setConfirmDelete(false);
        if (onDeleted) onDeleted();
        else onSaved();
        onClose();
      }
    } catch {
      setMessage("Could not delete the assignment. Please try again.");
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

        {/* Weekly Focus Pinning (for existing assignment) */}
        {assignment && onTogglePin && activeWeekStart && (
          (() => {
            const isPinned = weeklyFocusItems.some(
              (w) => w.assignment_id === assignment.id && w.week_start === activeWeekStart
            );
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
                  onClick={() => onTogglePin(assignment.id)}
                >
                  {isPinned ? "Remove pin" : "Pin to focus"}
                </Button>
              </div>
            );
          })()
        )}

        {/* Actions Footer */}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-col gap-2 border-t border-border/80 bg-[#fdf1f5]/90 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          {assignment ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete assignment
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
              {busy ? "Saving…" : assignment ? "Save changes" : "Create assignment"}
            </Button>
          </div>
        </div>
      </form>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!busy) setConfirmDelete(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete assignment permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title || assignment?.title}” and all its subtasks and links will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {busy ? "Deleting…" : "Delete assignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AssignmentDrawer(props: Props) {
  return (
    <DialogPrimitive.Root open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-40 bg-[#261820]/30 backdrop-blur-[1px] duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-[#fff9fb] text-popover-foreground shadow-[-12px_0_40px_#23182025] outline-none overflow-y-auto sm:max-w-xl duration-200 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
        >
          {props.isOpen && (
            <AssignmentDrawerForm
              key={
                props.assignment
                  ? props.assignment.id
                  : `new:${props.initialDate ?? "default"}:${props.initialCourseId ?? "default"}`
              }
              onClose={props.onClose}
              semester={props.semester}
              courses={props.courses}
              customTypes={props.customTypes}
              assignment={props.assignment}
              initialDate={props.initialDate}
              initialCourseId={props.initialCourseId}
              weeklyFocusItems={props.weeklyFocusItems}
              activeWeekStart={props.activeWeekStart}
              urls={props.urls}
              subtasks={props.subtasks}
              onSaved={props.onSaved}
              onDeleted={props.onDeleted}
              onCustomTypeCreated={props.onCustomTypeCreated}
              onTogglePin={props.onTogglePin}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

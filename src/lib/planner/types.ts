export type Semester = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  time_zone: string;
  archived_at: string | null;
  created_at: string;
};

export type PlannerCourse = {
  id: string;
  semester_id: string;
  hebacademy_course_id: string | null;
  name: string;
  color: string;
};

export type CourseMeeting = {
  id: string;
  semester_id: string;
  planner_course_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  location: string | null;
};

export type MeetingException = {
  id: string;
  semester_id: string;
  meeting_id: string;
  original_date: string;
  kind: "cancelled" | "changed";
  replacement_date: string | null;
  replacement_starts_at: string | null;
  replacement_ends_at: string | null;
  replacement_location: string | null;
};

export type MeetingSlot = Pick<CourseMeeting, "weekday" | "starts_at" | "ends_at" | "location">;
export type SemesterDraft = Pick<Semester, "name" | "start_date" | "end_date" | "time_zone">;
export type CourseDraft = Pick<PlannerCourse, "name" | "color" | "hebacademy_course_id">;
export type MeetingChange = Pick<MeetingException,
  "replacement_date" | "replacement_starts_at" | "replacement_ends_at" | "replacement_location">;

export const BUILTIN_ASSIGNMENT_TYPES = [
  "homework",
  "quiz",
  "exam",
  "lab",
  "reading",
  "project",
  "discussion",
  "other",
] as const;

export type BuiltinAssignmentType = (typeof BUILTIN_ASSIGNMENT_TYPES)[number];
export type AssignmentTypeKind = BuiltinAssignmentType | "custom";
export type AssignmentStatus = "not_started" | "in_progress" | "done";
export type AssignmentPriority = "normal" | "important";

export const ASSIGNMENT_TYPE_LABELS: Record<BuiltinAssignmentType, string> = {
  homework: "Homework",
  quiz: "Quiz",
  exam: "Exam",
  lab: "Lab",
  reading: "Reading",
  project: "Project",
  discussion: "Discussion",
  other: "Other",
};

export type PlannerCustomType = {
  id: string;
  name: string;
  created_at?: string;
};

export type AssignmentUrl = {
  id: string;
  assignment_id: string;
  url: string;
  label: string | null;
  position: number;
};

export type AssignmentSubtask = {
  id: string;
  assignment_id: string;
  title: string;
  is_done: boolean;
  due_date: string | null;
  position: number;
};

export type PlannerAssignment = {
  id: string;
  semester_id: string;
  planner_course_id: string | null;
  parent_series_id: string | null;
  original_due_date: string | null;
  title: string;
  description: string | null;
  start_date: string | null;
  due_date: string;
  due_time: string | null;
  type_kind: AssignmentTypeKind;
  custom_type_id: string | null;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  recurrence_kind: string;
  recurrence_interval: number;
  recurrence_weekdays: number[] | null;
  recurrence_end_kind: string;
  recurrence_until: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentUrlDraft = {
  id?: string;
  url: string;
  label?: string | null;
  position: number;
};

export type AssignmentSubtaskDraft = {
  id?: string;
  title: string;
  is_done: boolean;
  due_date?: string | null;
  position: number;
};

export type AssignmentDraft = {
  title: string;
  planner_course_id: string | null;
  start_date: string | null;
  due_date: string;
  due_time: string | null;
  type_kind: AssignmentTypeKind;
  custom_type_id: string | null;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  description: string | null;
  urls: AssignmentUrlDraft[];
  subtasks: AssignmentSubtaskDraft[];
};

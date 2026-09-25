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

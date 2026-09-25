import type { CourseMeeting, MeetingException, PlannerCourse, Semester } from "./types";

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= days;
}

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function ordinal(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateFromOrdinal(value: number) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startOrd = ordinal(start);
  const endOrd = ordinal(end);
  for (let d = startOrd; d <= endOrd; d += 86_400_000) {
    dates.push(dateFromOrdinal(d));
  }
  return dates;
}

export function addDays(date: string, days: number): string {
  return dateFromOrdinal(ordinal(date) + days * 86_400_000);
}

export function getMondayOfWeek(date: string): string {
  const w = weekdayOf(date);
  return addDays(date, -(w - 1));
}

export function getWeekSunday(monday: string): string {
  return addDays(monday, 6);
}

export function formatWeekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  return formatDateRange(monday, sunday);
}



export function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

export function displayTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch { return false; }
}

export function nextCalendarDay(date: string): string {
  return dateFromOrdinal(ordinal(date) + 86_400_000);
}

export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export function formatShortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

export function formatDateRange(start: string | null, due: string): string {
  if (!start || start === due) {
    return formatCalendarDate(due);
  }
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [dueYear, dueMonth, dueDay] = due.split("-").map(Number);
  if (startYear === dueYear) {
    if (startMonth === dueMonth) {
      return `${MONTHS[startMonth - 1]} ${startDay} – ${dueDay}, ${dueYear}`;
    }
    return `${MONTHS[startMonth - 1]} ${startDay} – ${MONTHS[dueMonth - 1]} ${dueDay}, ${dueYear}`;
  }
  return `${MONTHS[startMonth - 1]} ${startDay}, ${startYear} – ${MONTHS[dueMonth - 1]} ${dueDay}, ${dueYear}`;
}

export function isAssignmentOverdue(dueDate: string, status: string, today: string | null): boolean {
  if (!today || status === "done") return false;
  return dueDate < today;
}


export type MeetingOccurrence = {
  id: string;
  meetingId: string;
  courseId: string;
  courseName: string;
  color: string;
  originalDate: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string | null;
  changed: boolean;
};

// Date.UTC is used only as an ordinal calendar-day counter. Local wall-clock
// meeting times remain strings and are interpreted in the semester time zone.
export function meetingOccurrences(
  semester: Semester,
  courses: PlannerCourse[],
  meetings: CourseMeeting[],
  exceptions: MeetingException[],
  rangeStart: string,
  rangeEnd: string,
): MeetingOccurrence[] {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const exceptionByOccurrence = new Map(exceptions.map((exception) =>
    [`${exception.meeting_id}:${exception.original_date}`, exception]));
  const results: MeetingOccurrence[] = [];
  for (const meeting of meetings) {
    const course = courseById.get(meeting.planner_course_id);
    if (!course) continue;
    const candidateDates = new Set<string>();
    const firstDay = Math.max(ordinal(semester.start_date), ordinal(rangeStart));
    const lastDay = Math.min(ordinal(semester.end_date), ordinal(rangeEnd) - 86_400_000);
    for (let day = firstDay; day <= lastDay; day += 86_400_000) {
      candidateDates.add(dateFromOrdinal(day));
    }
    // A moved meeting may originate outside the visible window.
    for (const exception of exceptions) {
      if (exception.meeting_id === meeting.id && exception.kind === "changed"
        && exception.replacement_date && exception.replacement_date >= rangeStart
        && exception.replacement_date < rangeEnd) candidateDates.add(exception.original_date);
    }
    for (const date of candidateDates) {
      if (date < semester.start_date || date > semester.end_date) continue;
      if (weekdayOf(date) !== meeting.weekday) continue;
      const exception = exceptionByOccurrence.get(`${meeting.id}:${date}`);
      if (exception?.kind === "cancelled") continue;
      const actualDate = exception?.replacement_date ?? date;
      if (actualDate < rangeStart || actualDate >= rangeEnd
          || actualDate < semester.start_date || actualDate > semester.end_date) continue;
      results.push({
        id: `${meeting.id}:${date}`,
        meetingId: meeting.id,
        courseId: course.id,
        courseName: course.name,
        color: course.color,
        originalDate: date,
        date: actualDate,
        startTime: exception?.replacement_starts_at ?? meeting.starts_at,
        endTime: exception?.replacement_ends_at ?? meeting.ends_at,
        location: exception?.replacement_location ?? meeting.location,
        changed: exception?.kind === "changed",
      });
    }
  }
  return results.sort((a, b) => a.date.localeCompare(b.date)
    || a.startTime.localeCompare(b.startTime) || a.courseName.localeCompare(b.courseName));
}

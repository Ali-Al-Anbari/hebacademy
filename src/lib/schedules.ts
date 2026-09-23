export type ScheduleSelectionMode = "all" | "starred" | "manual";

export type ScheduleDraft = {
  name: string;
  description: string;
  courseId: string;
  deckId: string;
  examDate: string;
  selectionMode: ScheduleSelectionMode;
  manualCardIds: string[];
  reviewDates: string[];
};

export type ScheduleEdit = {
  name: string;
  description: string;
  examDate: string;
  selectionMode: ScheduleSelectionMode;
  manualCardIds: string[];
  reviewDates: { id: string | null; review_date: string }[];
};

// PostgreSQL date values and date inputs both use YYYY-MM-DD. Validate the
// calendar day without converting it to UTC or a timestamp.
export function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function formatCalendarDate(value: string) {
  if (!isCalendarDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setFullYear(year);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
    .format(date);
}

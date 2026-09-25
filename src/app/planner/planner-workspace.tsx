"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocalToday } from "@/lib/local-calendar";
import { isTimeZone } from "@/lib/planner/dates";
import type { CourseMeeting, MeetingException, PlannerCourse, Semester } from "@/lib/planner/types";
import { CoursePanel } from "./course-panel";
import { PlannerCalendar } from "./planner-calendar";
import { SemesterControls } from "./semester-controls";

export function PlannerWorkspace({ semesters, courses, meetings, exceptions, hebacademyCourses }: {
  semesters: Semester[];
  courses: PlannerCourse[];
  meetings: CourseMeeting[];
  exceptions: MeetingException[];
  hebacademyCourses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const today = useLocalToday();
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduleCourseId, setScheduleCourseId] = useState<string | null>(null);
  const visible = semesters.filter((semester) => Boolean(semester.archived_at) === archived);
  const selected = visible.find((semester) => semester.id === selectedId)
    ?? (today ? visible.find((semester) => semester.start_date <= today && today <= semester.end_date) : null)
    ?? visible[0] ?? null;
  const selectedCourses = courses.filter((course) => course.semester_id === selected?.id);
  const selectedMeetings = meetings.filter((meeting) => meeting.semester_id === selected?.id);
  const selectedExceptions = exceptions.filter((exception) => exception.semester_id === selected?.id);
  const archivedCount = semesters.filter((semester) => semester.archived_at).length;

  function saved(id?: string) {
    setSelectedId(id ?? null);
    setScheduleCourseId(null);
    router.refresh();
  }

  return <>
    <header className="page-intro planner-intro">
      <p className="page-eyebrow">Academic workspace</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="page-title">Planner</h1><p className="page-description">Keep your semester and class rhythm in view.</p></div>
        {archivedCount > 0 && <Button type="button" variant="ghost" onClick={() => { setArchived(!archived); setSelectedId(null); setScheduleCourseId(null); }}>{archived ? "Active semesters" : `Archived (${archivedCount})`}</Button>}
      </div>
    </header>
    {selected ? <>
      <div className="planner-semester-bar">
        <div className="min-w-0"><label htmlFor="planner-semester-select" className="mb-1 block text-xs font-semibold text-muted-foreground">{archived ? "Archived semester" : "Semester"}</label>
          <select id="planner-semester-select" className="planner-semester-select" value={selected.id} onChange={(event) => { setSelectedId(event.target.value); setScheduleCourseId(null); }}>
            {visible.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">{selected.start_date} – {selected.end_date} · {selected.time_zone}</p>
        </div>
        <SemesterControls semester={selected} onSaved={(id) => {
          if (selected.archived_at && !id) setArchived(false);
          saved(id ?? (selected.archived_at ? selected.id : undefined));
        }} />
      </div>
      {archived && <p className="mt-4 text-sm text-muted-foreground">This archived semester remains readable. You can unarchive it to resume planning.</p>}
      <div className="planner-workspace-grid mt-6">
        <CoursePanel key={`${selected.id}:${scheduleCourseId ?? "closed"}`} semester={selected} courses={selectedCourses}
          meetings={selectedMeetings} exceptions={selectedExceptions}
          hebacademyCourses={hebacademyCourses} scheduleCourseId={scheduleCourseId}
          setScheduleCourseId={setScheduleCourseId} onSaved={() => saved(selected.id)} />
        {!isTimeZone(selected.time_zone)
          ? <p role="alert" className="notice-error">This semester has an invalid time zone. Edit the semester before viewing its calendar.</p>
          : today ? <PlannerCalendar key={selected.id} semester={selected} courses={selectedCourses}
          meetings={selectedMeetings} exceptions={selectedExceptions} today={today}
          onEditRecurring={setScheduleCourseId} onSaved={() => saved(selected.id)} />
          : <div role="status" className="py-8 text-sm text-muted-foreground">Loading calendar…</div>}
      </div>
    </> : <div className="planner-empty mt-5">
      <h2 className="section-title">{archived ? "No archived semesters" : "Create your first semester"}</h2>
      <p className="page-description">{archived ? "Archived semesters will remain available here." : "Add your dates and time zone, then set up classes and weekly meetings."}</p>
      <div className="mt-5"><SemesterControls semester={null} onSaved={(id) => { setArchived(false); saved(id); }} /></div>
      {archived && <Button type="button" variant="ghost" className="mt-3" onClick={() => setArchived(false)}>Back to active semesters</Button>}
    </div>}
  </>;
}

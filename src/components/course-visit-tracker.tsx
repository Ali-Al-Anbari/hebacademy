"use client";

import { useEffect, useRef } from "react";
import { recordCourseVisit } from "@/app/course-actions";

export function CourseVisitTracker({ courseId }: { courseId: string }) {
  const trackedCourseId = useRef<string | null>(null);

  useEffect(() => {
    if (trackedCourseId.current === courseId) return;
    trackedCourseId.current = courseId;
    void recordCourseVisit(courseId).catch((error) => {
      console.error("Failed to record course visit:", error);
    });
  }, [courseId]);

  return null;
}

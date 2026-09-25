export type PlannerViewMode = "month" | "week" | "list";

export const PLANNER_VIEW_STORAGE_KEY = "hebacademy:planner:view";

export function getSavedPlannerView(): PlannerViewMode {
  if (typeof window === "undefined") return "month";
  try {
    const saved = localStorage.getItem(PLANNER_VIEW_STORAGE_KEY);
    if (saved === "month" || saved === "week" || saved === "list") {
      return saved;
    }
  } catch {
    // localStorage might be unavailable or restricted
  }
  return "month";
}

export function savePlannerView(view: PlannerViewMode): void {
  if (typeof window === "undefined") return;
  try {
    if (view === "month" || view === "week" || view === "list") {
      localStorage.setItem(PLANNER_VIEW_STORAGE_KEY, view);
    }
  } catch {
    // ignore storage write errors (e.g. private mode quota)
  }
}

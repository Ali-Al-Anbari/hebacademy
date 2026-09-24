"use client";

import { useSyncExternalStore } from "react";

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const subscribe = (onChange: () => void) => {
  const interval = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(interval);
};

export function useLocalToday() {
  return useSyncExternalStore(subscribe, localToday, () => null);
}

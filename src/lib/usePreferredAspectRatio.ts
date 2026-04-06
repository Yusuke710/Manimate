"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
  type AspectRatio,
} from "@/lib/aspect-ratio";

export const ASPECT_RATIO_PREF_KEY = "manimate-preferred-aspect-ratio";

export function usePreferredAspectRatio() {
  const [ratio, setRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const explicitSelectionCountRef = useRef(0);

  useEffect(() => {
    const selectionCountAtMount = explicitSelectionCountRef.current;
    let timer: number | null = null;

    try {
      const saved = localStorage.getItem(ASPECT_RATIO_PREF_KEY);
      if (isAspectRatio(saved)) {
        timer = window.setTimeout(() => {
          if (explicitSelectionCountRef.current !== selectionCountAtMount) return;
          setRatio(saved);
        }, 0);
      }
    } catch {}

    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((nextRatio: AspectRatio) => {
    explicitSelectionCountRef.current += 1;
    try { localStorage.setItem(ASPECT_RATIO_PREF_KEY, nextRatio); } catch {}
    setRatio(nextRatio);
  }, []);

  return [ratio, set] as const;
}

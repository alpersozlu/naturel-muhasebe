"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate from 0 → target in `duration` ms using ease-out-expo.
 *
 * Lightweight hook (no framer-motion). Resets when target changes.
 * Returns the current animated value to render.
 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // 0 ya da çok küçük değerler için animasyon yapma
    if (!Number.isFinite(target) || Math.abs(target) < 0.01) {
      setValue(target);
      return;
    }

    startRef.current = null;
    setValue(0);

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(target * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

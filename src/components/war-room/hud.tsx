"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./styles";

/** Four corner brackets around the nearest positioned parent. */
export function Corners({ color, size }: { color?: string; size?: number }) {
  const style = {
    ...(color ? { "--corner-color": color } : {}),
    ...(size ? { "--corner-size": `${size}px` } : {}),
  } as CSSProperties;
  return (
    <span className={styles.corners} style={style} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** Small uppercase monospaced label. */
export function Micro({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`${styles.micro} ${className}`}>{children}</span>;
}

const FPS = 24;

function timecode(ms: number, frames: boolean) {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  if (!frames) return `${hh}:${mm}:${ss}`;
  const ff = String(Math.floor(((total % 1000) / 1000) * FPS)).padStart(2, "0");
  return `${hh}:${mm}:${ss}:${ff}`;
}

/**
 * Camera-style running timecode (HH:MM:SS:FF). Writes straight to the DOM on
 * each animation frame so the rest of the page doesn't re-render at 60fps.
 * With reduced motion it drops the frame counter and ticks once a second.
 */
export function Timecode({ start, end }: { start: number | null; end: number | null }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => {
      const ms = start === null ? 0 : (end ?? Date.now()) - start;
      if (ref.current) ref.current.textContent = timecode(ms, !reduce);
    };
    paint();
    if (start === null || end !== null) return;
    if (reduce) {
      const id = window.setInterval(paint, 1000);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [start, end]);

  return (
    <span ref={ref} className="tabular-nums">
      00:00:00:00
    </span>
  );
}

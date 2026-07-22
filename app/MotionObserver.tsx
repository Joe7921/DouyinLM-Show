"use client";

import { useEffect } from "react";

export function MotionObserver() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("motion-ready");
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return () => root.classList.remove("motion-ready");
    }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }),
      { rootMargin: "0px 0px -10%", threshold: 0.12 },
    );
    items.forEach((item) => observer.observe(item));
    return () => {
      observer.disconnect();
      root.classList.remove("motion-ready");
    };
  }, []);
  return null;
}

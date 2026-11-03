// Motion constants for Framer Motion (the `motion` package). CSS uses --dur-fast and --dur; these mirror them.
export const DURATION = { fast: 0.12, base: 0.22, reveal: 0.42 } as const;
export const EASE = { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1] } as const;
/** Delay between items of one staggered reveal. */
export const STAGGER = 0.035;
/** How far revealed items travel, in pixels. */
export const RISE = 6;

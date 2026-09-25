const svg = { width: 16, height: 16, viewBox: "0 0 18 18", fill: "none", "aria-hidden": true } as const;
const line = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const PLUS = <svg {...svg}><path d="M9 3.5v11M3.5 9h11" {...line} /></svg>;
export const ARROW = <svg {...svg}><path d="M6 12 12 6M7 5.5h5.5V11" {...line} /></svg>;
export const FOLDER = (
  <svg {...svg}><path d="M2.5 5.2A1.5 1.5 0 0 1 4 3.7h3l1.4 1.8H14A1.5 1.5 0 0 1 15.5 7v6.2A1.5 1.5 0 0 1 14 14.7H4a1.5 1.5 0 0 1-1.5-1.5V5.2Z" {...line} /></svg>
);
export const MAGNIFIER = <svg {...svg}><circle cx="8" cy="8" r="4.8" {...line} /><path d="m11.6 11.6 3.4 3.4" {...line} /></svg>;
export const GLOBE = (
  <svg {...svg}><circle cx="9" cy="9" r="6.5" {...line} /><path d="M2.5 9h13M9 2.5c2 2.2 2 10.8 0 13M9 2.5c-2 2.2-2 10.8 0 13" {...line} /></svg>
);
export const TRASH = <svg {...svg}><path d="M3.5 5h11M7.2 5V3.5h3.6V5M5 5l.7 9.5h6.6L13 5" {...line} /></svg>;
export const BACK = <svg {...svg}><path d="M11 4 6 9l5 5" {...line} /></svg>;
export const EXTERNAL = (
  <svg {...svg}><path d="M10.5 3.5h4v4M14.5 3.5 8.5 9.5M13 10.5v3A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-7A1.5 1.5 0 0 1 4.5 5h3" {...line} /></svg>
);
export const PLUG = (
  <svg {...svg}><path d="M7 2.5v3.5M11 2.5v3.5M5 6h8v2.5a4 4 0 0 1-8 0V6ZM9 12.5V16" {...line} /></svg>
);
export const CHEVRON_RIGHT = <svg {...svg}><path d="M7 4l5 5-5 5" {...line} /></svg>;
export const CHEVRON_DOWN = <svg {...svg}><path d="M5 7l4 4 4-4" {...line} /></svg>;
export const CHECK = <svg {...svg}><path d="M4 9.4 7.2 12.6 14 5.4" {...line} /></svg>;

import type { SVGProps } from "react";

type Name = "tomorrow" | "add" | "week" | "settings" | "shoe" | "bag" | "rupee" | "pen" | "school" | "calendar";

const paths: Record<Name, string> = {
  tomorrow: "M8 5h8v14H5V8h3m0-3v6m0-6H5m8 5 2 2 4-5M8 15h5",
  add: "M12 5v14M5 12h14",
  week: "M4 6h16M4 12h16M4 18h16M8 4v4m8-4v4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  shoe: "M4 14c3 0 5-2 6-6l3 1c1 3 3 4 7 4v6H4Zm5-6 3 2m2 0 2 1",
  bag: "M5 9h14l-1 11H6Zm4 0V7a3 3 0 0 1 6 0v2m-6 4h.01m4 0h.01",
  rupee: "M6 5h12M6 9h12M8 5c5 0 5 7 0 7H6l8 7",
  pen: "m5 19 4-.8L19 8a2 2 0 0 0-3-3L6 15Zm9-11 4 4M5 19h14",
  school: "M4 20V9l8-5 8 5v11M8 20v-6h8v6M3 20h18M8 10h.01M12 10h.01M16 10h.01",
  calendar: "M5 4v3m14-3v3M4 8h16v12H4Zm3 5h3m3 0h3m-9 4h3",
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}

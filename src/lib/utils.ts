import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function remainingBalance(b: {
  allocated: number;
  carryForward: number;
  used: number;
  pending: number;
}) {
  return b.allocated + b.carryForward - b.used - b.pending;
}

export function formatDateRange(start: Date | string, end: Date | string) {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  if (s.toISOString().slice(0, 10) === e.toISOString().slice(0, 10)) {
    return s.toLocaleDateString("en-GB", opts);
  }
  return `${s.toLocaleDateString("en-GB", opts)} - ${e.toLocaleDateString("en-GB", opts)}`;
}

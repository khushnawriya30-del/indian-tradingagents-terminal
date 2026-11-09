import fs from "node:fs";
import path from "node:path";
import type { SessionPhase, SessionState } from "../types";

let cachedHolidays: Set<string> | null = null;

function getHolidays(): Set<string> {
  if (cachedHolidays) return cachedHolidays;
  const set = new Set<string>();
  let loadedFromFile = false;
  try {
    const p = path.resolve(process.cwd(), "..", "tradingagents", "dataflows", "nse_holidays.json");
    const pAlt = path.resolve(process.cwd(), "tradingagents", "dataflows", "nse_holidays.json");
    const target = fs.existsSync(p) ? p : fs.existsSync(pAlt) ? pAlt : null;
    if (target) {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      for (const year of Object.keys(parsed)) {
        if (Array.isArray(parsed[year])) {
          for (const d of parsed[year]) {
            set.add(d);
            loadedFromFile = true;
          }
        }
      }
    }
  } catch {
    // fall through to the emergency list
  }
  if (!loadedFromFile) {
    // Emergency-only list, used when the NSE holiday file is missing.
    const fallback = [
      "2026-01-26", "2026-03-04", "2026-03-21", "2026-03-26", "2026-03-31",
      "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-17",
      "2026-08-15", "2026-09-04", "2026-10-02", "2026-10-20", "2026-11-08",
      "2026-11-09", "2026-11-24", "2026-12-25"
    ];
    for (const f of fallback) set.add(f);
  }
  cachedHolidays = set;
  return set;
}

export function isHoliday(dateStr: string): boolean {
  return getHolidays().has(dateStr);
}

function getIstParts(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  const dayOfWeek = istDate.getUTCDay(); // 0 = Sun, 6 = Sat
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const minuteOfDay = hours * 60 + minutes;
  return { dateStr, dayOfWeek, hours, minutes, seconds, minuteOfDay, istDate };
}

function findPreviousCloseDate(currentDateStr: string, dayOfWeek: number): string {
  const d = new Date(`${currentDateStr}T00:00:00Z`);
  let steps = 1;
  while (steps < 15) {
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const str = `${y}-${m}-${day}`;
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isHoliday(str)) {
      return str;
    }
    steps++;
  }
  return currentDateStr;
}

function findNextOpen(currentDateStr: string, dayOfWeek: number, minuteOfDay: number): { nextIso: string; secondsToOpen: number } {
  let d = new Date(`${currentDateStr}T00:00:00Z`);
  const holidays = getHolidays();
  
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && !holidays.has(currentDateStr) && minuteOfDay < 9 * 60 + 15) {
    // Opens today at 09:15
    const targetMin = 9 * 60 + 15;
    const diffSeconds = (targetMin - minuteOfDay) * 60;
    return {
      nextIso: `${currentDateStr}T09:15:00+05:30`,
      secondsToOpen: Math.max(0, diffSeconds),
    };
  }

  // Roll forward to next trading day
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const str = `${y}-${m}-${day}`;
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(str)) {
      // Found next trading day
      const now = Date.now();
      const targetUtc = Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), 3, 45, 0); // 09:15 IST = 03:45 UTC
      const sec = Math.max(0, Math.floor((targetUtc - now) / 1000));
      return {
        nextIso: `${str}T09:15:00+05:30`,
        secondsToOpen: sec,
      };
    }
  }
}

export function sessionState(now = new Date()): SessionState {
  const { dateStr, dayOfWeek, minuteOfDay, seconds } = getIstParts(now);
  const holidays = getHolidays();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isHol = holidays.has(dateStr);

  let phase: SessionPhase = "closed";
  let isOpen = false;

  if (isWeekend) {
    phase = "weekend";
  } else if (isHol) {
    phase = "holiday";
  } else if (minuteOfDay >= 9 * 60 && minuteOfDay < 9 * 60 + 15) {
    phase = "pre_open";
  } else if (minuteOfDay >= 9 * 60 + 15 && minuteOfDay < 15 * 60 + 30) {
    phase = "open";
    isOpen = true;
  } else {
    phase = "closed";
  }

  const lastClose = isOpen || (!isWeekend && !isHol && minuteOfDay >= 15 * 60 + 30)
    ? dateStr
    : findPreviousCloseDate(dateStr, dayOfWeek);

  const { nextIso, secondsToOpen } = findNextOpen(dateStr, dayOfWeek, minuteOfDay);

  return {
    phase,
    is_open: isOpen,
    seconds_to_open: secondsToOpen,
    next_open_ist: nextIso,
    last_close_date: lastClose,
    session_date: dateStr,
    message: isOpen ? "Continuous trading active" : "Exchange closed; quotes held at last official close",
  };
}

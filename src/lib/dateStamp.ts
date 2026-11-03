// Local-date stamp helpers (R112 single source of truth).
// Author: loop-R112
// "Today's date as YYYY-MM-DD" was previously produced two incompatible ways:
//   1. new Date().toISOString().slice(0, 10) - 12 call sites in this repo (10
//      export filenames + 2 content stamps written back to PocketBase).
//      toISOString() serializes to UTC, so for a UTC+8 user any export/stamp
//      done before 08:00 local carries YESTERDAY's date. That is a real,
//      user-visible off-by-one-day defect (wrong export filename date, wrong
//      date stamped into competitor threat_notes / tender key-points notes).
//   2. inline `${getFullYear()}-${pad(getMonth()+1)}-${pad(getDate())}` lumps
//      re-implemented in KanbanBoard / OpportunityDetailPanel / DocListPanel.
// Both formats now live here on the LOCAL calendar; the UTC sites are fixed and
// the duplicated inline formatters collapse to these two functions.

/** Local calendar date as `YYYY-MM-DD`. Defaults to today. */
export function localDateStamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local calendar date as `YYYYMMDD` (for compact export filenames). */
export function localDateCompact(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

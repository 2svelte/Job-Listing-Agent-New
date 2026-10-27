// Searches the daily sync runs when the request doesn't specify its own filters.
// "Melbourne Region" is Adzuna's metro Melbourne area (CBD and suburbs); regional Victoria sits under other regions.
export const SYNC_LOCATION = "Melbourne Region";

export const SYNC_TITLES = [
  "Business Analyst",
  "Junior Business Analyst",
  "Graduate Business Analyst",
  "Graduate Analyst",
  "Junior Analyst",
  "Demand Planner",
  "Junior Demand Planner",
  "Graduate Planner",
  "AI Developer",
  "Graduate AI Developer",
  "Process Improvement",
  "Business Intelligence",
  "Analyst"
];

export const DEFAULT_SYNC_PAGES = 2;

export const isMetroMelbourne = (area: string[] | undefined) => Boolean(area?.includes(SYNC_LOCATION));

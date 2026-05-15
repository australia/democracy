import { loadBoundaries } from "./boundaries";

// ABS State Electoral Division shapefile is a single dataset covering every
// state and territory. Each feature has STE_CODE21 (single-char state code)
// that we use to partition into the right jurisdiction's lower chamber.
const STE_TO_JURIS: Record<
  string,
  "nsw" | "vic" | "qld" | "sa" | "wa" | "tas" | "nt" | "act"
> = {
  "1": "nsw",
  "2": "vic",
  "3": "qld",
  "4": "sa",
  "5": "wa",
  "6": "tas",
  "7": "nt",
  "8": "act",
  // "9" = Other Territories — skipped
};

const UNICAMERAL: Array<"qld" | "act" | "nt"> = ["qld", "act", "nt"];

export async function loadAbsSedForState(
  shpPath: string,
  state: "nsw" | "vic" | "qld" | "sa" | "wa" | "tas" | "nt" | "act",
  sourceRev = "ABS SED 2025",
): Promise<void> {
  const stateCode = Object.entries(STE_TO_JURIS).find(([, v]) => v === state)?.[0];
  if (!stateCode) throw new Error(`unknown state ${state}`);
  const chamberKind: "lower" | "unicameral" = UNICAMERAL.includes(
    state as "qld" | "act" | "nt",
  )
    ? "unicameral"
    : "lower";

  // ABS SED names sometimes carry a region suffix in parens, e.g.
  // "Albert Park (Southern Metropolitan)" for VIC LA seats. Strip the suffix
  // so the lookup code matches what the parliament site publishes
  // ("Albert Park").
  const stripRegionSuffix = (n: string) => n.replace(/\s*\([^)]+\)\s*$/, "").trim();

  console.log(`Loading ABS SED -> ${state} (${chamberKind})`);
  await loadBoundaries({
    shpPath,
    jurisdictionCode: state,
    chamberKind,
    nameField: "SED_NAME25",
    codeFromName: stripRegionSuffix,
    sourceRev,
    filter: (p) => String(p["STE_CODE21"]) === stateCode,
  });
}

export async function loadAbsSedAllStates(shpPath: string): Promise<void> {
  for (const state of Object.values(STE_TO_JURIS)) {
    await loadAbsSedForState(shpPath, state);
  }
}

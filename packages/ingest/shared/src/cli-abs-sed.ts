import { loadAbsSedAllStates, loadAbsSedForState } from "./abs-sed";

const shp = process.argv[2];
const state = process.argv[3] as
  | "nsw"
  | "vic"
  | "qld"
  | "sa"
  | "wa"
  | "tas"
  | "nt"
  | "act"
  | undefined;

if (!shp) {
  console.error("usage: tsx cli-abs-sed.ts <path/to/SED.shp> [state]");
  process.exit(1);
}

(state ? loadAbsSedForState(shp, state) : loadAbsSedAllStates(shp))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

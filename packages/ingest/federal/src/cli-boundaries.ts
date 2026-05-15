import { loadFederalBoundaries } from "./boundaries";

const arg = process.argv[2];
const shp =
  arg ??
  new URL(
    "../../../../data/boundaries/federal/AUS_ELB_region.shp",
    import.meta.url,
  ).pathname;

loadFederalBoundaries(shp)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

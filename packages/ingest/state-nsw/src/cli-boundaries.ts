import { loadBoundaries } from "@au/ingest-shared";

const arg = process.argv[2];
const shp =
  arg ??
  new URL(
    "../../../../data/boundaries/nsw/2021GDA94/StateElectoralDistrict2021_GDA94_region.shp",
    import.meta.url,
  ).pathname;

loadBoundaries({
  shpPath: shp,
  jurisdictionCode: "nsw",
  chamberKind: "lower",
  nameField: "districtna",
  sourceRev: "NSWEC 2021 redistribution",
})
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Canonical raw shapes the scrapers produce. Each jurisdiction's scraper
// normalises its source into these shapes; the apply step diffs and upserts
// into the typed reps/electorates tables.

export interface RawRep {
  externalId: string; // e.g. aph MPID, NSWLA member number, etc.
  fullName: string;
  given?: string;
  family?: string;
  honorific?: string;
  party?: string;

  chamberKind: "lower" | "upper" | "unicameral";

  electorateCode?: string; // for electorate-bound members
  stateCode?: "NSW" | "VIC" | "QLD" | "WA" | "SA" | "TAS" | "ACT" | "NT"; // for state-wide senators

  photoUrl?: string;
  profileUrl?: string;

  primaryEmail?: string;
  altEmails?: string[];
  contactFormUrl?: string;
  contactFormKind?: "aph" | "sitecore" | "drupal" | "custom" | "none";
}

export interface RawElectorate {
  code: string;
  name: string;
  chamberKind: "lower" | "upper" | "unicameral";
  geojson: object; // GeoJSON Geometry (Polygon | MultiPolygon)
  sourceRev?: string;
}

import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// PostGIS geography column. Stored value is text in/out (WKT/GeoJSON via
// PostGIS functions); we wrap inserts with ST_GeomFromGeoJSON() etc. at the
// query site.
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(MultiPolygon, 4326)";
  },
});

// ---------------------------------------------------------------------------
// Reference: who governs and how
// ---------------------------------------------------------------------------

export const jurisdictionCode = pgEnum("jurisdiction_code", [
  "federal",
  "nsw",
  "vic",
  "qld",
  "wa",
  "sa",
  "tas",
  "act",
  "nt",
]);

export const chamberKind = pgEnum("chamber_kind", [
  "lower",
  "upper",
  "unicameral",
]);

export const jurisdictions = pgTable("jurisdictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: jurisdictionCode("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const chambers = pgTable(
  "chambers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdictionId: uuid("jurisdiction_id")
      .references(() => jurisdictions.id, { onDelete: "cascade" })
      .notNull(),
    kind: chamberKind("kind").notNull(),
    name: text("name").notNull(),
    // How many members from this chamber represent any one voter. Lower house
    // is normally 1. Federal Senate is 12 per state, 2 per territory.
    membersPerVoter: integer("members_per_voter").notNull(),
  },
  (t) => ({
    jurisdictionKindUq: uniqueIndex("chambers_jurisdiction_kind_uq").on(
      t.jurisdictionId,
      t.kind,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Electorates — geographic divisions with polygons.
// Senators are state-wide so they don't have an electorate row; they are
// attached to reps via reps.state_code instead.
// ---------------------------------------------------------------------------

export const electorates = pgTable(
  "electorates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chamberId: uuid("chamber_id")
      .references(() => chambers.id, { onDelete: "cascade" })
      .notNull(),
    code: text("code").notNull(), // e.g. AEC division code or state code
    name: text("name").notNull(),
    geom: geography("geom").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .defaultNow()
      .notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }), // null = current
    sourceRev: text("source_rev"), // free-form: e.g. "AEC 2024 redistribution"
  },
  (t) => ({
    chamberCodeUq: uniqueIndex("electorates_chamber_code_validto_uq").on(
      t.chamberId,
      t.code,
      t.validTo,
    ),
    geomIdx: index("electorates_geom_gix").using("gist", t.geom),
  }),
);

// ---------------------------------------------------------------------------
// Representatives
// ---------------------------------------------------------------------------

export const stateCode = pgEnum("state_code", [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
]);

export const contactFormKind = pgEnum("contact_form_kind", [
  "aph",
  "sitecore",
  "drupal",
  "custom",
  "none",
]);

export const reps = pgTable(
  "reps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chamberId: uuid("chamber_id")
      .references(() => chambers.id, { onDelete: "restrict" })
      .notNull(),
    // Electorate-bound members (House MPs, state lower-house members) carry
    // electorateId. State-wide senators carry stateCode instead.
    electorateId: uuid("electorate_id").references(() => electorates.id, {
      onDelete: "set null",
    }),
    stateCode: stateCode("state_code"),

    externalId: text("external_id"), // e.g. aph MPID
    fullName: text("full_name").notNull(),
    given: text("given"),
    family: text("family"),
    honorific: text("honorific"),
    party: text("party"),

    photoUrl: text("photo_url"),
    profileUrl: text("profile_url"),

    primaryEmail: varchar("primary_email", { length: 254 }),
    altEmails: jsonb("alt_emails").$type<string[]>().default([]).notNull(),
    contactFormUrl: text("contact_form_url"),
    contactFormKind: contactFormKind("contact_form_kind").default("none").notNull(),

    hasKnownBounce: boolean("has_known_bounce").default(false).notNull(),
    activeAsOf: timestamp("active_as_of", { withTimezone: true })
      .defaultNow()
      .notNull(),
    inactiveAsOf: timestamp("inactive_as_of", { withTimezone: true }),
    lastVerified: timestamp("last_verified", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    chamberExternalUq: uniqueIndex("reps_chamber_external_uq").on(
      t.chamberId,
      t.externalId,
    ),
    electorateIdx: index("reps_electorate_idx").on(t.electorateId),
    stateIdx: index("reps_state_idx").on(t.stateCode),
  }),
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull().unique(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    given: text("given"),
    family: text("family"),

    // Verified postal address (only stored after the user explicitly submits
    // an address; we keep it to enforce constituent-only gating)
    postalAddress: text("postal_address"),
    postcode: varchar("postcode", { length: 4 }),
    addressLat: text("address_lat"), // stored as text to avoid float drift
    addressLng: text("address_lng"),
    addressVerifiedAt: timestamp("address_verified_at", { withTimezone: true }),

    // Cached electorate IDs by chamber. Populated when address is set, cleared
    // on address change or on roster redistribution.
    federalLowerElectorateId: uuid("federal_lower_electorate_id").references(
      () => electorates.id,
    ),
    stateLowerElectorateId: uuid("state_lower_electorate_id").references(
      () => electorates.id,
    ),
    stateUpperElectorateId: uuid("state_upper_electorate_id").references(
      () => electorates.id,
    ),
    addressStateCode: stateCode("address_state_code"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    emailVerifiedIdx: index("users_email_verified_idx").on(t.emailVerifiedAt),
  }),
);

// ---------------------------------------------------------------------------
// Messages — what a user writes and where it goes
// ---------------------------------------------------------------------------

export const moderationStatus = pgEnum("moderation_status", [
  "pending",
  "approved",
  "rejected",
  "auto_approved",
]);

export const deliveryStatus = pgEnum("delivery_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "failed",
]);

export const channelKind = pgEnum("channel_kind", ["email", "form"]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodySimhash: text("body_simhash"), // hex; used for mass-mailing detection
  moderationStatus: moderationStatus("moderation_status")
    .default("auto_approved")
    .notNull(),
  moderationReason: text("moderation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const messageRecipients = pgTable(
  "message_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    repId: uuid("rep_id")
      .references(() => reps.id, { onDelete: "restrict" })
      .notNull(),
    intendedChannel: channelKind("intended_channel").notNull(),
    status: deliveryStatus("status").default("queued").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    messageRepUq: uniqueIndex("message_recipients_message_rep_uq").on(
      t.messageId,
      t.repId,
    ),
    statusIdx: index("message_recipients_status_idx").on(t.status),
  }),
);

export const deliveryAttempts = pgTable("delivery_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientId: uuid("recipient_id")
    .references(() => messageRecipients.id, { onDelete: "cascade" })
    .notNull(),
  channel: channelKind("channel").notNull(),
  transportId: text("transport_id"), // SES message id, Playwright run id, etc.
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  success: boolean("success").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// Roster audit — every scrape run lands here before reps gets updated
// ---------------------------------------------------------------------------

export const rosterAudit = pgTable("roster_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  jurisdiction: jurisdictionCode("jurisdiction").notNull(),
  scrapedAt: timestamp("scraped_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  rowsRaw: jsonb("rows_raw").notNull(),
  diff: jsonb("diff"), // summary of adds/updates/removals vs current reps
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Auth — magic link tokens (one-shot)
// ---------------------------------------------------------------------------

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    purpose: text("purpose").notNull(), // 'email_verify' | 'magic_login'
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("auth_tokens_token_hash_uq").on(t.tokenHash),
  }),
);

export type Jurisdiction = typeof jurisdictions.$inferSelect;
export type Chamber = typeof chambers.$inferSelect;
export type Electorate = typeof electorates.$inferSelect;
export type Rep = typeof reps.$inferSelect;
export type NewRep = typeof reps.$inferInsert;
export type User = typeof users.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageRecipient = typeof messageRecipients.$inferSelect;

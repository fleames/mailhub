import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  real,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageStatus = pgEnum("message_status", [
  "received", // inbound, fully ingested
  "ingest_failed", // raw stored but parse failed (dead-letter, reprocessable)
  "queued", // outbound, waiting for undo window / scheduled time
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "canceled", // undo-send
]);

export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "done",
  "failed",
  "canceled",
]);

/** An address as stored in to/cc/bcc/participants JSON columns. */
export type Address = { email: string; name?: string };

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#22c55e"),
  icon: text("icon").notNull().default("🌐"),
  catchAll: boolean("catch_all").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const signatures = pgTable("signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  html: text("html").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    localPart: text("local_part").notNull(),
    displayName: text("display_name"),
    signatureId: uuid("signature_id").references(() => signatures.id, {
      onDelete: "set null",
    }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("mailboxes_domain_local_uq").on(t.domainId, t.localPart)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    company: text("company"),
    notes: text("notes"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    conversationCount: integer("conversation_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("contacts_email_uq").on(sql`lower(${t.email})`)]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull().default(""),
    normalizedSubject: text("normalized_subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    participants: jsonb("participants").$type<Address[]>().notNull().default([]),
    domainId: uuid("domain_id").references(() => domains.id, {
      onDelete: "set null",
    }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    messageCount: integer("message_count").notNull().default(0),
    unreadCount: integer("unread_count").notNull().default(0),
    attachmentCount: integer("attachment_count").notNull().default(0),
    hasOutbound: boolean("has_outbound").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastDirection: messageDirection("last_direction"),
    starred: boolean("starred").notNull().default(false),
    isSpam: boolean("is_spam").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    internalNotes: text("internal_notes"),
    aiSummary: text("ai_summary"),
    aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_last_message_idx").on(t.lastMessageAt.desc()),
    index("conversations_domain_idx").on(t.domainId),
    index("conversations_norm_subject_idx").on(t.normalizedSubject),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").references(() => domains.id, {
      onDelete: "set null",
    }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
      onDelete: "set null",
    }),
    direction: messageDirection("direction").notNull(),
    status: messageStatus("status").notNull(),
    // RFC 5322 threading headers
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    referencesIds: jsonb("references_ids").$type<string[]>().notNull().default([]),
    fromEmail: text("from_email").notNull().default(""),
    fromName: text("from_name"),
    toJson: jsonb("to_json").$type<Address[]>().notNull().default([]),
    ccJson: jsonb("cc_json").$type<Address[]>().notNull().default([]),
    bccJson: jsonb("bcc_json").$type<Address[]>().notNull().default([]),
    replyTo: text("reply_to"),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    rawR2Key: text("raw_r2_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    spamScore: real("spam_score"),
    spamReasons: jsonb("spam_reasons").$type<string[]>().notNull().default([]),
    resendId: text("resend_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    error: text("error"),
    isRead: boolean("is_read").notNull().default(false),
    starred: boolean("starred").notNull().default(false),
    /** Date header of the email (or receive time). Drives ordering. */
    date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.date),
    index("messages_message_id_idx").on(t.messageId),
    index("messages_from_idx").on(sql`lower(${t.fromEmail})`),
    index("messages_date_idx").on(t.date.desc()),
    index("messages_resend_idx").on(t.resendId),
  ]
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull().default("attachment"),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    r2Key: text("r2_key").notNull(),
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_message_idx").on(t.messageId)]
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#8b5cf6"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const conversationTags = pgTable(
  "conversation_tags",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.tagId] })]
);

export type DraftAttachment = {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  mailboxId: uuid("mailbox_id").references(() => mailboxes.id, {
    onDelete: "set null",
  }),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  replyToMessageId: uuid("reply_to_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  toJson: jsonb("to_json").$type<Address[]>().notNull().default([]),
  ccJson: jsonb("cc_json").$type<Address[]>().notNull().default([]),
  bccJson: jsonb("bcc_json").$type<Address[]>().notNull().default([]),
  subject: text("subject").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  attachmentsJson: jsonb("attachments_json")
    .$type<DraftAttachment[]>()
    .notNull()
    .default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Audit log + activity feed + delivery events. Append-only. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_created_idx").on(t.createdAt.desc()), index("events_type_idx").on(t.type)]
);

/** DB-backed job queue: scheduled sends, snoozes, reminders, ingest retries. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("jobs_pending_idx").on(t.status, t.runAt)]
);

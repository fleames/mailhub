import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { logEvent } from "./bus";
import { getSetting, setSetting } from "./config";

const SETTING_KEY = "inbox_rules";
const MAX_RULES = 40;

export const RULE_FIELDS = ["from", "to", "subject"] as const;
export const RULE_ACTIONS = ["archive", "star", "spam", "trash", "tag", "mark_read"] as const;

export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

export type InboxRule = {
  id: string;
  enabled: boolean;
  field: RuleField;
  contains: string;
  action: RuleAction;
  tagId: string | null;
};

function isField(v: string): v is RuleField {
  return (RULE_FIELDS as readonly string[]).includes(v);
}
function isAction(v: string): v is RuleAction {
  return (RULE_ACTIONS as readonly string[]).includes(v);
}

/** Keep only well-formed rules. Invalid rows are dropped rather than failing the save. */
export function normalizeInboxRules(raw: unknown): InboxRule[] {
  if (!Array.isArray(raw)) return [];
  const out: InboxRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const field = typeof row.field === "string" ? row.field : "";
    const action = typeof row.action === "string" ? row.action : "";
    const contains = typeof row.contains === "string" ? row.contains.trim() : "";
    if (!isField(field) || !isAction(action) || !contains || contains.length > 200) continue;
    const tagId = typeof row.tagId === "string" && row.tagId ? row.tagId : null;
    if (action === "tag" && !tagId) continue;
    const id = typeof row.id === "string" && row.id ? row.id : randomUUID();
    out.push({
      id,
      enabled: row.enabled !== false,
      field,
      contains,
      action,
      tagId: action === "tag" ? tagId : null,
    });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

export async function getInboxRules(): Promise<InboxRule[]> {
  return normalizeInboxRules(await getSetting<unknown>(SETTING_KEY));
}

export async function setInboxRules(raw: unknown): Promise<InboxRule[]> {
  const rules = normalizeInboxRules(raw);
  await setSetting(SETTING_KEY, rules);
  return rules;
}

function matches(rule: InboxRule, input: { fromEmail: string; toEmails: string[]; subject: string }): boolean {
  const needle = rule.contains.toLowerCase();
  if (rule.field === "from") return input.fromEmail.toLowerCase().includes(needle);
  if (rule.field === "to") return input.toEmails.some((e) => e.toLowerCase().includes(needle));
  return input.subject.toLowerCase().includes(needle);
}

/**
 * Apply enabled rules to a just-stored inbound message.
 * Returns quiet=true when the message should not raise a notification
 * (archived, trashed, marked spam, or marked read).
 */
export async function applyInboxRules(input: {
  conversationId: string;
  messageId: string;
  fromEmail: string;
  toEmails: string[];
  subject: string;
}): Promise<{ quiet: boolean; applied: string[] }> {
  const rules = (await getInboxRules()).filter((r) => r.enabled);
  const matched = rules.filter((r) => matches(r, input));
  if (matched.length === 0) return { quiet: false, applied: [] };

  const patch: {
    archivedAt?: Date;
    trashedAt?: Date;
    starred?: boolean;
    isSpam?: boolean;
  } = {};
  let markRead = false;
  let quiet = false;
  const tagIds: string[] = [];

  for (const rule of matched) {
    if (rule.action === "archive") {
      patch.archivedAt = new Date();
      quiet = true;
    } else if (rule.action === "trash") {
      patch.trashedAt = new Date();
      quiet = true;
    } else if (rule.action === "star") {
      patch.starred = true;
    } else if (rule.action === "spam") {
      patch.isSpam = true;
      quiet = true;
    } else if (rule.action === "mark_read") {
      markRead = true;
      quiet = true;
    } else if (rule.action === "tag" && rule.tagId) {
      tagIds.push(rule.tagId);
    }
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(t.conversations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.conversations.id, input.conversationId));
  }

  if (markRead) {
    await db
      .update(t.messages)
      .set({ isRead: true })
      .where(eq(t.messages.id, input.messageId));
    await db
      .update(t.conversations)
      .set({
        unreadCount: sql`greatest(${t.conversations.unreadCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(t.conversations.id, input.conversationId));
  }

  for (const tagId of [...new Set(tagIds)]) {
    await db
      .insert(t.conversationTags)
      .values({ conversationId: input.conversationId, tagId })
      .onConflictDoNothing();
  }

  const applied = matched.map((r) => r.id);
  await logEvent("message.rule", {
    conversationId: input.conversationId,
    messageId: input.messageId,
    payload: { rules: applied, actions: matched.map((r) => r.action) },
  });

  return { quiet, applied };
}

import { getSetting, setSetting } from "./config";

const SETTING_KEY = "blocked_sender_domains";

/** Normalize a domain or email to a bare lowercase domain, or null if invalid. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop() ?? "";
  s = s.replace(/^\.+|\.+$/g, "");
  if (!s || s.includes(" ") || !s.includes(".")) return null;
  return s;
}

export async function getBlockedSenderDomains(): Promise<string[]> {
  const raw = await getSetting<unknown>(SETTING_KEY);
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const d = normalizeDomain(item);
    if (d) out.push(d);
  }
  return [...new Set(out)].sort();
}

export async function setBlockedSenderDomains(domains: string[]): Promise<void> {
  const normalized = [
    ...new Set(
      domains
        .map((d) => normalizeDomain(d))
        .filter((d): d is string => Boolean(d))
    ),
  ].sort();
  await setSetting(SETTING_KEY, normalized);
}

/**
 * True if the sender's domain matches a blocked entry exactly, or is a
 * subdomain of one (blocking example.com also blocks mail.example.com).
 */
export function isDomainBlocked(emailOrDomain: string, blocked: string[]): boolean {
  const domain = normalizeDomain(emailOrDomain);
  if (!domain || blocked.length === 0) return false;
  return blocked.some((b) => domain === b || domain.endsWith(`.${b}`));
}

export async function isSenderBlocked(emailOrDomain: string | null | undefined): Promise<boolean> {
  if (!emailOrDomain) return false;
  const blocked = await getBlockedSenderDomains();
  return isDomainBlocked(emailOrDomain, blocked);
}

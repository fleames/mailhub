/**
 * Seed: realistic demo data across five domains so the UI is fully
 * exercisable before real mail flows in. Idempotent-ish: aborts if
 * domains already exist.
 */
import { eq as pgEq } from "drizzle-orm";
import { db, t, pg } from "./index";
import type { Address } from "./schema";
import { putObject } from "@/lib/storage";
import { makeSnippet, normalizeSubject, textToHtml } from "@/lib/utils";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function main() {
  const existing = await db.select().from(t.domains);
  if (existing.length > 0) {
    console.log("Domains already exist — skipping seed.");
    await pg.end();
    return;
  }

  console.log("Seeding domains…");
  const domainSpecs = [
    { name: "brightloop.io", color: "#22c55e", icon: "🟢" },
    { name: "pixelforge.dev", color: "#a855f7", icon: "🟣" },
    { name: "northbeam.co", color: "#ef4444", icon: "🔴" },
    { name: "driftstack.app", color: "#3b82f6", icon: "🔵" },
    { name: "clearpath.tools", color: "#f59e0b", icon: "🟠" },
  ];
  const domains = await db.insert(t.domains).values(domainSpecs).returning();
  const byName = new Map(domains.map((d) => [d.name, d]));

  console.log("Seeding mailboxes…");
  const mailboxSpecs: { domain: string; local: string; display?: string; isDefault?: boolean }[] = [
    { domain: "brightloop.io", local: "hello", display: "BrightLoop", isDefault: true },
    { domain: "brightloop.io", local: "support", display: "BrightLoop Support" },
    { domain: "brightloop.io", local: "billing" },
    { domain: "pixelforge.dev", local: "hello", display: "PixelForge" },
    { domain: "pixelforge.dev", local: "noreply" },
    { domain: "northbeam.co", local: "hello", display: "NorthBeam" },
    { domain: "northbeam.co", local: "sales" },
    { domain: "driftstack.app", local: "info", display: "DriftStack" },
    { domain: "clearpath.tools", local: "contact", display: "ClearPath" },
    { domain: "clearpath.tools", local: "admin" },
  ];
  const mailboxes = await db
    .insert(t.mailboxes)
    .values(
      mailboxSpecs.map((m) => ({
        domainId: byName.get(m.domain)!.id,
        localPart: m.local,
        displayName: m.display ?? null,
        isDefault: m.isDefault ?? false,
      }))
    )
    .returning();
  const mb = (domain: string, local: string) =>
    mailboxes.find(
      (m) => m.domainId === byName.get(domain)!.id && m.localPart === local
    )!;

  console.log("Seeding tags, signature, template…");
  const tags = await db
    .insert(t.tags)
    .values([
      { name: "Support", color: "#0ea5e9" },
      { name: "Billing", color: "#f59e0b" },
      { name: "Client", color: "#22c55e" },
      { name: "Launch", color: "#a855f7" },
      { name: "Urgent", color: "#f43f5e" },
      { name: "SEO", color: "#14b8a6" },
    ])
    .returning();
  const tagByName = new Map(tags.map((x) => [x.name, x]));

  await db.insert(t.signatures).values({
    name: "Default",
    html: `<p>—<br><b>Alex</b><br>Founder, many small tools<br><a href="https://brightloop.io">brightloop.io</a></p>`,
    isDefault: true,
  });
  await db.insert(t.templates).values([
    {
      name: "Support first reply",
      subject: "",
      bodyHtml:
        "<p>Hi!</p><p>Thanks for reaching out — I'm looking into this now and will get back to you within a few hours.</p>",
    },
    {
      name: "Refund confirmation",
      subject: "Your refund is on the way",
      bodyHtml:
        "<p>Hi,</p><p>I've processed the refund — it should land in 5–10 business days depending on your bank.</p>",
    },
  ]);

  console.log("Seeding conversations…");

  type MsgSpec = {
    dir: "inbound" | "outbound";
    from: Address;
    to: Address[];
    text: string;
    at: Date;
    read?: boolean;
    status?: string;
    spamScore?: number;
    spamReasons?: string[];
    attachments?: { filename: string; contentType: string; content: Buffer }[];
    scheduledAt?: Date;
    error?: string;
  };

  async function makeConv(opts: {
    domain: string;
    mailboxLocal: string;
    subject: string;
    msgs: MsgSpec[];
    starred?: boolean;
    spam?: boolean;
    archived?: boolean;
    trashed?: boolean;
    snoozedUntil?: Date;
    tags?: string[];
    aiSummary?: string;
  }) {
    const domain = byName.get(opts.domain)!;
    const mailbox = mb(opts.domain, opts.mailboxLocal);
    const last = opts.msgs[opts.msgs.length - 1];
    const participants: Address[] = [];
    for (const m of opts.msgs) {
      for (const a of [m.from, ...m.to]) {
        if (!participants.some((p) => p.email === a.email)) participants.push(a);
      }
    }
    const unread = opts.msgs.filter((m) => m.dir === "inbound" && m.read === false).length;
    const attachmentCount = opts.msgs.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);

    const [conv] = await db
      .insert(t.conversations)
      .values({
        subject: opts.subject,
        normalizedSubject: normalizeSubject(opts.subject),
        snippet: makeSnippet(last.text),
        participants,
        domainId: domain.id,
        mailboxId: mailbox.id,
        messageCount: opts.msgs.length,
        unreadCount: unread,
        attachmentCount,
        hasOutbound: opts.msgs.some((m) => m.dir === "outbound"),
        lastMessageAt: last.at,
        lastDirection: last.dir,
        starred: opts.starred ?? false,
        isSpam: opts.spam ?? false,
        archivedAt: opts.archived ? last.at : null,
        trashedAt: opts.trashed ? last.at : null,
        snoozedUntil: opts.snoozedUntil ?? null,
        aiSummary: opts.aiSummary ?? null,
        aiSummaryAt: opts.aiSummary ? last.at : null,
        createdAt: opts.msgs[0].at,
      })
      .returning();

    let prevMsgId: string | null = null;
    const refs: string[] = [];
    for (const [i, m] of opts.msgs.entries()) {
      const rfcId = `<seed-${conv.id.slice(0, 8)}-${i}@${opts.domain}>`;
      const [row] = await db
        .insert(t.messages)
        .values({
          conversationId: conv.id,
          domainId: domain.id,
          mailboxId: mailbox.id,
          direction: m.dir,
          status: (m.status ?? (m.dir === "inbound" ? "received" : "delivered")) as never,
          messageId: rfcId,
          inReplyTo: prevMsgId,
          referencesIds: [...refs],
          fromEmail: m.from.email,
          fromName: m.from.name ?? null,
          toJson: m.to,
          subject: i === 0 ? opts.subject : `Re: ${opts.subject}`,
          snippet: makeSnippet(m.text),
          textBody: m.text,
          htmlBody: textToHtml(m.text),
          headers: { "message-id": rfcId },
          sizeBytes: 800 + m.text.length * 2,
          spamScore: m.spamScore ?? (m.dir === "inbound" ? 0 : null),
          spamReasons: m.spamReasons ?? [],
          scheduledAt: m.scheduledAt ?? null,
          sentAt: m.dir === "outbound" && !m.scheduledAt ? m.at : null,
          deliveredAt: m.dir === "outbound" && m.status === "delivered" ? m.at : null,
          error: m.error ?? null,
          isRead: m.dir === "outbound" ? true : m.read !== false,
          date: m.at,
          createdAt: m.at,
        })
        .returning();
      prevMsgId = rfcId;
      refs.push(rfcId);

      for (const [ai, att] of (m.attachments ?? []).entries()) {
        const key = `att/${row.id}/${ai}-${att.filename}`;
        await putObject(key, att.content, att.contentType);
        await db.insert(t.attachments).values({
          messageId: row.id,
          filename: att.filename,
          contentType: att.contentType,
          sizeBytes: att.content.length,
          r2Key: key,
        });
      }

      await db.insert(t.events).values({
        type: m.dir === "inbound" ? "message.received" : "message.sent",
        conversationId: conv.id,
        messageId: row.id,
        payload: { from: m.from.email, subject: opts.subject },
        createdAt: m.at,
      });
    }

    for (const tagName of opts.tags ?? []) {
      const tag = tagByName.get(tagName);
      if (tag) {
        await db.insert(t.conversationTags).values({ conversationId: conv.id, tagId: tag.id });
      }
    }
    return conv;
  }

  const me = (d: string, l: string, name?: string): Address => ({
    email: `${l}@${d}`,
    name,
  });

  const invoice = {
    filename: "invoice-2041.txt",
    contentType: "text/plain",
    content: Buffer.from(
      "INVOICE #2041\n\nBrightLoop Pro — annual\nAmount: $190.00\nStatus: PAID\n\nThank you for your business!"
    ),
  };
  const screenshot = {
    filename: "screenshot.png",
    contentType: "image/png",
    content: PNG_1PX,
  };
  const report = {
    filename: "seo-audit-report.txt",
    contentType: "text/plain",
    content: Buffer.from(
      "SEO AUDIT — driftstack.app sample\n\n- 34 pages crawled\n- 3 broken links\n- 12 missing meta descriptions\n- Core Web Vitals: LCP 2.9s (needs work)\n"
    ),
  };

  // 1. Active support thread with reply, attachment, tags — unread follow-up
  await makeConv({
    domain: "brightloop.io",
    mailboxLocal: "support",
    subject: "Can't connect my custom domain",
    tags: ["Support", "Urgent"],
    aiSummary:
      "Sofia can't connect her custom domain; DNS propagation was the initial suspect. You asked for her registrar and she confirmed it's Namecheap with a screenshot attached.\n- Action: walk her through Namecheap DNS settings",
    msgs: [
      {
        dir: "inbound",
        from: { email: "sofia@brightstudio.io", name: "Sofia Meyer" },
        to: [me("brightloop.io", "support", "BrightLoop Support")],
        text: "Hi! I added my custom domain yesterday but it still shows 'pending verification'. DNS was updated hours ago. Can you check what's wrong?\n\nSofia",
        at: hoursAgo(26),
      },
      {
        dir: "outbound",
        from: me("brightloop.io", "support", "BrightLoop Support"),
        to: [{ email: "sofia@brightstudio.io", name: "Sofia Meyer" }],
        text: "Hey Sofia, thanks for the report! Which registrar are you using? Some (especially Namecheap) keep an old parking CNAME that shadows the verification record. A screenshot of your DNS panel would help.",
        at: hoursAgo(22),
        status: "delivered",
      },
      {
        dir: "inbound",
        from: { email: "sofia@brightstudio.io", name: "Sofia Meyer" },
        to: [me("brightloop.io", "support", "BrightLoop Support")],
        text: "It's Namecheap indeed — screenshot attached. I see a parking CNAME there, should I delete it?",
        at: hoursAgo(2),
        read: false,
        attachments: [screenshot],
      },
    ],
  });

  // 2. Billing thread with invoice attachment
  await makeConv({
    domain: "brightloop.io",
    mailboxLocal: "billing",
    subject: "Invoice #2041 — BrightLoop Pro annual",
    tags: ["Billing"],
    msgs: [
      {
        dir: "inbound",
        from: { email: "billing@stripe-notifications.com", name: "Stripe" },
        to: [me("brightloop.io", "billing")],
        text: "A payment of $190.00 from customer brightstudio.io succeeded. Invoice attached.",
        at: hoursAgo(30),
        attachments: [invoice],
      },
    ],
  });

  // 3. Unread sales lead — starred
  await makeConv({
    domain: "northbeam.co",
    mailboxLocal: "sales",
    subject: "Bulk audit pricing for 40 client sites?",
    starred: true,
    tags: ["Client"],
    msgs: [
      {
        dir: "inbound",
        from: { email: "marcus@growthagency.de", name: "Marcus Weber" },
        to: [me("northbeam.co", "sales")],
        text: "Hello — we run a 12-person agency and would like to run monthly audits on ~40 client sites. Do you offer volume pricing? Happy to jump on a call this week.\n\nMarcus Weber\nGrowth Agency Berlin",
        at: hoursAgo(5),
        read: false,
      },
    ],
  });

  // 4. SEO report thread, replied + delivered
  await makeConv({
    domain: "driftstack.app",
    mailboxLocal: "info",
    subject: "Your sample audit report",
    tags: ["SEO"],
    msgs: [
      {
        dir: "inbound",
        from: { email: "jenny@localbakery.dk", name: "Jenny Holm" },
        to: [me("driftstack.app", "info", "DriftStack")],
        text: "Hi, I signed up yesterday — could you send me the sample audit you mention on the pricing page?",
        at: hoursAgo(50),
      },
      {
        dir: "outbound",
        from: me("driftstack.app", "info", "DriftStack"),
        to: [{ email: "jenny@localbakery.dk", name: "Jenny Holm" }],
        text: "Hi Jenny! Sample report attached — this is the exact format you'd get for your own site. Let me know if you have questions.",
        at: hoursAgo(48),
        status: "delivered",
        attachments: [report],
      },
    ],
  });

  // 5. Launch feedback — unread
  await makeConv({
    domain: "clearpath.tools",
    mailboxLocal: "contact",
    subject: "Loved the Product Hunt launch — quick feedback",
    tags: ["Launch"],
    msgs: [
      {
        dir: "inbound",
        from: { email: "dev@nightbuild.app", name: "Kenji Tanaka" },
        to: [me("clearpath.tools", "contact", "ClearPath")],
        text: "Congrats on the launch! One thing: the comparison table on mobile overflows horizontally. Otherwise really slick. Upvoted!",
        at: hoursAgo(9),
        read: false,
      },
    ],
  });

  // 6. Newsletter — read, archived
  await makeConv({
    domain: "pixelforge.dev",
    mailboxLocal: "hello",
    subject: "Google's June core update is rolling out",
    archived: true,
    tags: ["SEO"],
    msgs: [
      {
        dir: "inbound",
        from: { email: "digest@searchweekly.com", name: "Search Weekly" },
        to: [me("pixelforge.dev", "hello", "PixelForge")],
        text: "This week: the June core update, INP replacing FID in CWV dashboards, and a study of 1M SERPs on AI overview impact…",
        at: hoursAgo(70),
      },
    ],
  });

  // 7. Spam
  await makeConv({
    domain: "clearpath.tools",
    mailboxLocal: "admin",
    subject: "CONGRATULATIONS!!! You have been selected $$$",
    spam: true,
    msgs: [
      {
        dir: "inbound",
        from: { email: "prize@lucky-winner.xyz", name: "Prize Dept" },
        to: [me("clearpath.tools", "admin")],
        text: "You have been selected as our lucky winner! Claim your $5,000 gift card now. Act now, offer expires! 100% free, risk-free!",
        at: hoursAgo(14),
        read: false,
        spamScore: 8,
        spamReasons: ["DMARC failed", "Suspicious sender TLD", "Spam phrases: act now, you have been selected, 100% free"],
      },
    ],
  });

  // 8. Phishing-looking spam
  await makeConv({
    domain: "brightloop.io",
    mailboxLocal: "hello",
    subject: "Your account will be suspended - verify now",
    spam: true,
    msgs: [
      {
        dir: "inbound",
        from: { email: "security@paypa1-alerts.top", name: "PayPal Security" },
        to: [me("brightloop.io", "hello")],
        text: "Dear customer, unusual activity was detected. Verify your account within 24 hours or it will be suspended. Click here to verify your identity.",
        at: hoursAgo(40),
        read: false,
        spamScore: 7,
        spamReasons: ["SPF failed", "Suspicious sender TLD", "Envelope/From domain mismatch"],
      },
    ],
  });

  // 9. Scheduled outbound (queued, in the future) + pending job
  const scheduled = await makeConv({
    domain: "northbeam.co",
    mailboxLocal: "hello",
    subject: "Following up on the audit results",
    msgs: [
      {
        dir: "outbound",
        from: me("northbeam.co", "hello", "NorthBeam"),
        to: [{ email: "marcus@growthagency.de", name: "Marcus Weber" }],
        text: "Hi Marcus, just following up on the audit results I sent last week — any questions? Happy to walk through them on a call.",
        at: new Date(),
        status: "queued",
        scheduledAt: new Date(Date.now() + 26 * 3600_000),
      },
    ],
  });
  const [schedMsg] = await db
    .select({ id: t.messages.id })
    .from(t.messages)
    .where(pgEq(t.messages.conversationId, scheduled.id));
  await db.insert(t.jobs).values({
    type: "send_message",
    payload: { messageId: schedMsg.id },
    runAt: new Date(Date.now() + 26 * 3600_000),
  });

  // 10. Bounced outbound
  await makeConv({
    domain: "pixelforge.dev",
    mailboxLocal: "hello",
    subject: "Welcome to PixelForge — getting started",
    msgs: [
      {
        dir: "outbound",
        from: me("pixelforge.dev", "hello", "PixelForge"),
        to: [{ email: "typo@nonexistent-domain-xyz.com" }],
        text: "Welcome aboard! Here are the three steps to get your first pages indexed…",
        at: hoursAgo(20),
        status: "bounced",
        error: "550 5.1.1 The email account that you tried to reach does not exist",
      },
    ],
  });

  // 11. Snoozed conversation
  await makeConv({
    domain: "brightloop.io",
    mailboxLocal: "hello",
    subject: "Partnership idea: co-marketing with DirectoryStack",
    snoozedUntil: new Date(Date.now() + 48 * 3600_000),
    msgs: [
      {
        dir: "inbound",
        from: { email: "anna@directorystack.com", name: "Anna Lind" },
        to: [me("brightloop.io", "hello", "BrightLoop")],
        text: "Hey! We have overlapping audiences but not competing products. Interested in a newsletter swap or bundle deal next month?",
        at: hoursAgo(60),
      },
    ],
  });

  // 12. Trashed
  await makeConv({
    domain: "clearpath.tools",
    mailboxLocal: "contact",
    subject: "Quick question about your API",
    trashed: true,
    msgs: [
      {
        dir: "inbound",
        from: { email: "random@throwaway.email" },
        to: [me("clearpath.tools", "contact")],
        text: "do u have api??",
        at: hoursAgo(90),
      },
    ],
  });

  // Backfill volume: a few older messages spread across 14 days
  console.log("Seeding volume history…");
  for (let day = 3; day <= 13; day++) {
    const n = (day * 7) % 3;
    for (let j = 0; j <= n; j++) {
      await makeConv({
        domain: domainSpecs[(day + j) % domainSpecs.length].name,
        mailboxLocal: mailboxSpecs.find(
          (m) => m.domain === domainSpecs[(day + j) % domainSpecs.length].name
        )!.local,
        subject: `Weekly metrics digest — day ${day}`,
        archived: true,
        msgs: [
          {
            dir: (day + j) % 3 === 0 ? "outbound" : "inbound",
            from:
              (day + j) % 3 === 0
                ? me(domainSpecs[(day + j) % domainSpecs.length].name, mailboxSpecs.find((m) => m.domain === domainSpecs[(day + j) % domainSpecs.length].name)!.local)
                : { email: `reports@metrics-mail.com`, name: "Metrics Mail" },
            to: [{ email: "reports@metrics-mail.com" }],
            text: `Automated digest for day ${day}: traffic steady, signups nominal.`,
            at: hoursAgo(day * 24 + j * 3),
          },
        ],
      });
    }
  }

  console.log("Seeding contacts…");
  // Contacts are normally fed by the ingest pipeline; seed them directly here.
  await db
    .insert(t.contacts)
    .values([
      { email: "sofia@brightstudio.io", name: "Sofia Meyer", company: "Bright Studio", notes: "Custom domain issue — Namecheap. Friendly, technical.", messageCount: 3, conversationCount: 1, lastContactedAt: hoursAgo(22) },
      { email: "marcus@growthagency.de", name: "Marcus Weber", company: "Growth Agency Berlin", messageCount: 2, conversationCount: 2, lastContactedAt: hoursAgo(1) },
      { email: "jenny@localbakery.dk", name: "Jenny Holm", company: "Local Bakery", messageCount: 2, conversationCount: 1, lastContactedAt: hoursAgo(48) },
      { email: "dev@nightbuild.app", name: "Kenji Tanaka", company: "Nightbuild", messageCount: 1, conversationCount: 1 },
      { email: "anna@directorystack.com", name: "Anna Lind", company: "DirectoryStack", messageCount: 1, conversationCount: 1 },
      { email: "digest@searchweekly.com", name: "Search Weekly", messageCount: 1, conversationCount: 1 },
    ])
    .onConflictDoNothing();

  console.log("Seed complete.");
  await pg.end();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await pg.end();
  process.exit(1);
});

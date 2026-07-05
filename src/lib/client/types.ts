export type Address = { email: string; name?: string };

export type Domain = {
  id: string;
  name: string;
  color: string;
  icon: string;
  catchAll: boolean;
  active: boolean;
  mailboxCount?: number;
  conversationCount?: number;
  storageBytes?: number;
};

export type Mailbox = {
  id: string;
  domainId: string;
  localPart: string;
  displayName: string | null;
  signatureId: string | null;
  isDefault: boolean;
  email?: string;
  domain?: Domain;
};

export type Tag = { id: string; name: string; color: string; conversationCount?: number };

export type Attachment = {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentId: string | null;
  isInline: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  status: string;
  messageId: string | null;
  fromEmail: string;
  fromName: string | null;
  toJson: Address[];
  ccJson: Address[];
  bccJson: Address[];
  replyTo: string | null;
  subject: string;
  snippet: string;
  textBody: string | null;
  htmlBody: string | null;
  headers: Record<string, string>;
  spamScore: number | null;
  spamReasons: string[];
  scheduledAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  error: string | null;
  isRead: boolean;
  starred: boolean;
  sizeBytes: number;
  date: string;
  attachments: Attachment[];
};

export type Conversation = {
  id: string;
  subject: string;
  snippet: string;
  participants: Address[];
  domainId: string | null;
  mailboxId: string | null;
  connectedAccountId: string | null;
  messageCount: number;
  unreadCount: number;
  attachmentCount: number;
  hasOutbound: boolean;
  hasInbound: boolean;
  lastMessageAt: string;
  lastDirection: "inbound" | "outbound" | null;
  starred: boolean;
  isSpam: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
  snoozedUntil: string | null;
  internalNotes: string | null;
  aiSummary: string | null;
  aiSummaryAt: string | null;
  domain: Domain | null;
  mailbox: Mailbox | null;
  tags: Tag[];
};

export type Thread = Conversation & { messages: Message[] };

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  notes: string | null;
  lastContactedAt: string | null;
  conversationCount: number;
  messageCount: number;
};

export type Draft = {
  id: string;
  mailboxId: string | null;
  conversationId: string | null;
  replyToMessageId: string | null;
  toJson: Address[];
  ccJson: Address[];
  bccJson: Address[];
  subject: string;
  bodyHtml: string;
  attachmentsJson: UploadedAttachment[];
  updatedAt: string;
  mailbox?: Mailbox | null;
  domain?: Domain | null;
};

export type UploadedAttachment = {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type Counts = {
  inbox_unread: number;
  spam: number;
  snoozed: number;
  scheduled: number;
  drafts: number;
  trash: number;
  domains: { id: string; unread: number }[];
  mailboxes: { id: string; unread: number }[];
  connectedAccounts: { id: string; unread: number }[];
};

export type MailboxGroup = { localPart: string; domainCount: number; unread: number };

export type ConnectedAccount = {
  id: string;
  provider: "microsoft";
  emailAddress: string;
  displayName: string | null;
  status: "active" | "reauth_required" | "error";
  signatureId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type Signature = { id: string; name: string; html: string; isDefault: boolean };
export type Template = {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  category: string;
  shortcut: string | null;
};

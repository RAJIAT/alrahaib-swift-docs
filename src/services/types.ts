/**
 * Shared domain types — formerly defined in demoStore.ts. These are pure TS
 * types used by the UI and the Directus service layer.
 */

export type Role = "admin" | "supervisor" | "agent";
export type StaffType = "underwriter" | "sales";
export type RequestStatus =
  | "new" | "linkSent" | "processing" | "sold" | "rejected" | "reupload";

export type Branch = {
  id: number;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  is_active: boolean;
};

export type Agent = {
  userId: string;
  id: string;
  name: string;
  email?: string;
  branch?: string;
  active: boolean;
  role: "agent" | "supervisor";
  staffType?: StaffType;
  supervisorId?: string;
  assignedUnderwriterId?: string;
  createdByUserId?: string;
  createdByRole?: Role;
  pendingApproval?: boolean;
  removalRequest?: {
    requestedByUserId: string;
    requestedByName: string;
    reason: string;
    requestedAt: string;
  };
};

export type Note = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  text: string;
  kind: "comment" | "missing";
  createdAt: string;
  resolvedAt?: string;
};

export type Attachment = { name: string; type: string; size: number; url: string };

export type Quote = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  uploadedByUserId: string;
  uploadedByName: string;
  uploadedAt: string;
};

export type InsuranceRequest = {
  id: string;
  uuid: string;
  agentId: string;
  agentUserId?: string;
  agentName: string;
  originAgentId?: string;
  originAgentUserId?: string;
  originAgentName?: string;
  assignedAt?: string;
  branch: string;
  status: RequestStatus;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes: Note[];
  images: {
    registration: string[];
    license: string[];
    emirates: string[];
    vehicleMedia: Array<
      | { kind: "image"; url: string }
      | { kind: "video"; name: string; size: number; type: string }
    >;
    inspection?: string;
    attachments: Attachment[];
    missingAttachments?: Attachment[];
  };
  quotes?: Quote[];
};

export type NotificationKind =
  | "removal_requested" | "removal_approved" | "removal_dismissed"
  | "user_pending" | "user_approved"
  | "request_new" | "request_status" | "info";

export type AppNotification = {
  id: string;
  recipientUserId: string;
  title: string;
  body?: string;
  kind: NotificationKind;
  link?: string;
  read: boolean;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: Role | "anonymous";
  actorBranch?: string | null;
  action: string;
  entityType: "request" | "agent" | "auth";
  entityId: string | null;
  entityLabel?: string | null;
  branch?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

export type AppSettings = { requireAdminApproval: boolean };

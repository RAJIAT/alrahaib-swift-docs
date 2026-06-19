/**
 * Audit service — Directus-backed (Phase 3e).
 *
 * Thin re-export layer for legacy import paths. All reads/writes go through
 * the `audit_log` collection via `directusNotify.ts`.
 */
import {
  clearAudit as dxClearAudit,
  fetchAudit as dxFetchAudit,
  fetchRequestAuditHistory,
  subscribeAudit as dxSubscribeAudit,
} from "./directusNotify";
import type { AuditEntry } from "./types";

export type { AuditEntry };
export type AuditAction =
  | "request.status_changed"
  | "request.created"
  | "request.reassigned"
  | "request.assigned_to_underwriter"
  | "request.returned_to_sales"
  | "request.underwriter_changed"
  | "request.sales_changed"
  | "request.document_uploaded"
  | "request.document_removed"
  | "request.reupload_requested"
  | "request.note_added"
  | "request.quote_uploaded"
  | "request.quote_removed"
  | "request.shared_with_customer"
  | "request.quote_confirmed"
  | "request.payment_link_sent"
  | "agent.created"
  | "agent.pending_created"
  | "agent.approved"
  | "agent.updated"
  | "agent.activated"
  | "agent.deactivated"
  | "agent.deleted"
  | "auth.login"
  | "auth.logout"
  | "settings.approval_changed";
export type AuditEntityType = "request" | "agent" | "auth";

export const fetchAudit = dxFetchAudit;
export const fetchRequestHistory = fetchRequestAuditHistory;
export const clearAudit = dxClearAudit;
export const subscribeAudit = dxSubscribeAudit;

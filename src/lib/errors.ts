import { Notice } from "obsidian";

import { $ } from "../lang/lang";
import { isNonFastForwardError } from "./github-api";

/**
 * GitHub returns raw JSON such as `{"message":"Bad credentials"}` or
 * `{"message":"Update is not a fast forward"}`. Showing that in the top-right
 * Notice is useless to most users. This module maps the failure to a short,
 * actionable message in the current UI language (zh / en via `$()`), while
 * the original error stays in the console for troubleshooting.
 */

export type SyncErrorKind =
  | "auth"
  | "conflict"
  | "rateLimit"
  | "permission"
  | "notFound"
  | "unknown";

export interface FormattedSyncError {
  kind: SyncErrorKind;
  message: string;
  /** Notice timeout in milliseconds. */
  duration: number;
}

export type Translate = (key: string) => string;

/** Needs the user to do something -> keep the Notice on screen longer. */
export const ACTIONABLE_NOTICE_MS = 9000;
/** Conflicts carry two lines plus a "your edits are safe" reassurance. */
export const CONFLICT_NOTICE_MS = 7000;
export const DEFAULT_NOTICE_MS = 5000;

const MESSAGE_KEY_BY_KIND: Record<Exclude<SyncErrorKind, "unknown">, string> = {
  auth: "syncError401",
  conflict: "syncError422",
  rateLimit: "syncError429",
  permission: "syncError403",
  notFound: "syncError404",
};

const TRACKED_STATUSES = [401, 403, 404, 409, 422, 429, 500, 503];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

/**
 * Prefer the structured `status` attached by `apiFailure()`. Fall back to
 * parsing the message so plain Errors thrown by older code paths still work.
 */
function errorStatus(error: unknown): number | null {
  const candidate = error as { status?: unknown } | null;
  if (candidate && typeof candidate === "object" && typeof candidate.status === "number") {
    return candidate.status;
  }

  const text = errorText(error);
  const http = text.match(/\bHTTP\s+(\d{3})\b/i);
  if (http) return Number(http[1]);

  for (const status of TRACKED_STATUSES) {
    if (new RegExp(`\\b${status}\\b`).test(text)) return status;
  }
  return null;
}

export function classifySyncError(error: unknown): {
  kind: SyncErrorKind;
  status: number | null;
} {
  const text = errorText(error);
  const status = errorStatus(error);

  // 422 "Update is not a fast forward": another device advanced the branch.
  if (isNonFastForwardError(error) || /not a fast forward/i.test(text)) {
    return { kind: "conflict", status: status ?? 422 };
  }
  // 401 Bad credentials: expired / revoked / pasted with trailing whitespace.
  if (status === 401 || /bad credentials|unauthorized|token.*(expired|revoked)/i.test(text)) {
    return { kind: "auth", status: status ?? 401 };
  }
  // GitHub uses 403 for secondary rate limits and 429 for primary limits.
  if (status === 429 || /rate limit|secondary rate|abuse detection/i.test(text)) {
    return { kind: "rateLimit", status: status ?? 429 };
  }
  // 403 without a rate-limit message is a permissions problem, e.g. a
  // fine-grained PAT that was not granted access to this repository.
  if (status === 403) {
    return { kind: "permission", status };
  }
  if (status === 404 || /\bnot found\b/i.test(text)) {
    return { kind: "notFound", status: status ?? 404 };
  }
  return { kind: "unknown", status };
}

/**
 * Translate is injectable so tests can assert both the Chinese and English
 * wording without mutating Obsidian's global locale.
 */
export function formatSyncError(error: unknown, translate: Translate = $): FormattedSyncError {
  const { kind } = classifySyncError(error);

  if (kind === "unknown") {
    // Keep the original message as a diagnostic fallback, but cap it so a
    // raw GitHub JSON blob does not fill the whole Notice.
    const raw = errorText(error);
    const message = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    return { kind, message: `❌ ${message}`, duration: DEFAULT_NOTICE_MS };
  }

  return {
    kind,
    message: `❌ ${translate(MESSAGE_KEY_BY_KIND[kind])}`,
    duration: kind === "conflict" ? CONFLICT_NOTICE_MS : ACTIONABLE_NOTICE_MS,
  };
}

/** Single entry point for every user-visible sync failure in fs.ts. */
export function showSyncErrorNotice(error: unknown, logLabel: string): void {
  console.error(logLabel, error);
  const { message, duration } = formatSyncError(error);
  new Notice(message, duration);
}

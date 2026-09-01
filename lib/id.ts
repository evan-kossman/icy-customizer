import { randomBytes } from "node:crypto";

/** URL-safe, sortable-enough primary key. */
export function createId(): string {
  return (
    Date.now().toString(36) + randomBytes(8).toString("hex")
  );
}

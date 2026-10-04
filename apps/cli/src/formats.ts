/**
 * TypeBox format registry for the Task 1 contract schemas.
 *
 * `Value.Check` treats an unregistered `format` as a validation failure, so
 * the contract's `uuid` and `date-time` formats must be registered before any
 * response is validated. Values are checked strictly so contract drift fails
 * closed instead of slipping through.
 */
import { TypeSystem } from "@sinclair/typebox/system";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let registered = false;

export function registerContractFormats(): void {
  if (registered) return;
  registered = true;
  TypeSystem.Format("uuid", (value) => UUID.test(value));
  TypeSystem.Format(
    "date-time",
    (value) => DATE_TIME.test(value) && Number.isFinite(Date.parse(value)),
  );
  TypeSystem.Format("email", (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

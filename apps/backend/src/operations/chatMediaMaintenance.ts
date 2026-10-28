import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPool } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "../modules/auth.js";
import { reconcileChatMediaUpload } from "../modules/chatMedia.js";
import { inspectDeletedChatMedia, reconcileStoppedLabUpload } from "../modules/chatMediaMaintenance.js";
import { createChatMediaStorage } from "../modules/chatMediaStorage.js";

const usage = `Usage:
  node dist/operations/chatMediaMaintenance.js inventory
  node dist/operations/chatMediaMaintenance.js reconcile --account UUID --media UUID --attempt UUID
  node dist/operations/chatMediaMaintenance.js cancel-local --account UUID --media UUID --attempt UUID

inventory is read-only and prints sanitized metadata only.
reconcile checks one completed attempt and may settle its database fence.
cancel-local atomically revokes one uncommitted local upload capability.
No command deletes objects or changes bucket configuration.
`;

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help") { process.stdout.write(usage); return; }
  const mode = args[0];
  if (mode !== "inventory" && mode !== "reconcile" && mode !== "cancel-local") throw new Error("Invalid mode");
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]!, value = args[index + 1];
    if (!["--account", "--media", "--attempt"].includes(name) || flags.has(name) || !value ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid exact scope");
    flags.set(name, value);
  }
  if ((mode === "inventory" && flags.size !== 0) || (mode !== "inventory" && flags.size !== 3)) throw new Error("Invalid scope");
  const config = loadConfig(), pool = createPool(config), storage = createChatMediaStorage(config);
  try {
    if (mode === "inventory") {
      process.stdout.write(`${JSON.stringify(await inspectDeletedChatMedia(pool, storage), null, 2)}\n`);
      return;
    }
    if (mode === "cancel-local" && storage.provider !== "local") throw new Error("Local storage is required");
    const account = flags.get("--account")!, media = flags.get("--media")!, attempt = flags.get("--attempt")!;
    const owner = (await pool.query<{ user_id: string; kind: AuthContext["userKind"]; workspace_state: string | null }>(
      `SELECT media.created_by_user_id AS user_id,users.kind,workspace.state AS workspace_state FROM chat_media_assets media
       JOIN users ON users.account_id=media.account_id AND users.id=media.created_by_user_id
       LEFT JOIN lab_test_workspaces workspace ON workspace.target_account_id=media.account_id
       WHERE media.account_id=$1 AND media.id=$2`, [account, media])).rows[0];
    if (!owner) throw new ApiError(404, "CHAT_MEDIA_NOT_FOUND", "The image was not found.");
    const result = owner.kind === "lab_human" && owner.workspace_state === "deleting"
      ? await reconcileStoppedLabUpload(pool, storage, account, media, attempt, { cancelLocal: mode === "cancel-local" })
      : await reconcileChatMediaUpload(pool,
      { accountId: account, userId: owner.user_id, userKind: owner.kind } as AuthContext, storage, media, attempt, { cancelLocal: mode === "cancel-local" });
    process.stdout.write(`${JSON.stringify({ mode, fingerprint: sha256(JSON.stringify([account, media, attempt])), status: result.status })}\n`);
    if (result.status === "unresolved") process.exitCode = 2;
  } finally { await pool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof ApiError ? error.code : "CHAT_MEDIA_MAINTENANCE_FAILED"}\n`);
    process.exitCode = 1;
  });
}

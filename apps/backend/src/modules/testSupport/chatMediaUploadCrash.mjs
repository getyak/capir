import { Pool } from "pg";
import { uploadChatMediaContent } from "../chatMedia.js";

const fixture = JSON.parse(process.env.CHAT_MEDIA_CRASH_CASE);
const database = new URL(process.env.CHAT_MEDIA_TEST_DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(database.hostname)) throw new Error("Disposable database required");
const pool = new Pool({ connectionString: database.href });
const storage = {
  provider: "s3", labScopeID: "synthetic-store",
  async put(_key, _body, _type, attemptId) {
    process.send({ started: true, attemptId });
    await new Promise(() => {});
  },
  async get() { throw new Error("No content read permitted in the crash fixture"); },
  async delete() { throw new Error("No deletion permitted in the crash fixture"); },
};
await uploadChatMediaContent(pool, fixture.auth, storage, fixture.mediaId, new Uint8Array([1]), "image/png");

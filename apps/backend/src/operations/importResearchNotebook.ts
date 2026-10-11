import { Pool } from "pg";
import { importResearchNotebook, researchNotebookOwner } from "../modules/researchNotebookImport.js";

// Operator-only stdin entry: never an HTTP route, default seed or startup action.
// Supply DATABASE_URL from the already authorized service environment.
const chunks: Buffer[] = [];
let bytes = 0;
try {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw new Error("INPUT_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  chunks.length = 0;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_REQUIRED");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await researchNotebookOwner(client, { email: input.email, displayName: input.displayName, password: input.password });
      input.password = "";
      const receipt = await importResearchNotebook(client, owner, input.notebook);
      await client.query("COMMIT");
      process.stdout.write(JSON.stringify({ owner, receipt }) + "\n");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
} catch {
  // Database and input errors may contain private material. Print no raw exception.
  process.stderr.write("RESEARCH_IMPORT_FAILED: transaction rolled back; inspect scoped state before retry.\n");
  process.exitCode = 1;
}

import { fileURLToPath } from "node:url";

import {
  SIMULATED_CAPABILITY,
  SIMULATED_REVERSAL_CAPABILITY,
} from "@talent-signal/contracts";

import { loadConfig } from "../config.js";
import { createPool, inTransaction } from "./pool.js";
import { encodePasswordCredential } from "../modules/passwordCredential.js";

const IDS = {
  alphaAccount: "10000000-0000-4000-8000-000000000001",
  alphaRecruiter: "10000000-0000-4000-8000-000000000011",
  alphaReviewer: "10000000-0000-4000-8000-000000000012",
  alphaAdmin: "10000000-0000-4000-8000-000000000013",
  alphaRecruiterGrant: "10000000-0000-4000-8000-000000000021",
  alphaReviewerGrant: "10000000-0000-4000-8000-000000000022",
  alphaAdminGrant: "10000000-0000-4000-8000-000000000023",
  alphaRecruiterReversalGrant: "10000000-0000-4000-8000-000000000031",
  alphaReviewerReversalGrant: "10000000-0000-4000-8000-000000000032",
  alphaAdminReversalGrant: "10000000-0000-4000-8000-000000000033",
  betaAccount: "20000000-0000-4000-8000-000000000001",
  betaRecruiter: "20000000-0000-4000-8000-000000000011",
  betaGrant: "20000000-0000-4000-8000-000000000021",
  betaReversalGrant: "20000000-0000-4000-8000-000000000031",
} as const;

export async function seed(): Promise<void> {
  const config = loadConfig();
  if (process.env.NODE_ENV === "production" || !config.simulatedAuthEnabled) {
    throw new Error("Fixture accounts require explicit simulated authentication in a development backend.");
  }
  const pool = createPool(config);
  const adminPassword = await encodePasswordCredential(
    "cubxxw",
    "6375627878772d6c6f63616c2d61646d",
  );
  try {
    await inTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO accounts(id, slug, name)
         VALUES
           ($1, 'fixture-alpha', 'Fixture Alpha Search'),
           ($2, 'fixture-beta', 'Fixture Beta Search')
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           name = EXCLUDED.name`,
        [IDS.alphaAccount, IDS.betaAccount],
      );
      // The fixture password identity owns its reserved normalized email like
      // any real account; seeding remains explicit development-fixture data.
      await client.query(
        `INSERT INTO account_email_reservations(normalized_email, state, account_id, user_id)
         VALUES ('test@gmail.com', 'owned', $1, $2)
         ON CONFLICT (normalized_email) DO UPDATE SET
           state = 'owned', account_id = EXCLUDED.account_id, user_id = EXCLUDED.user_id,
           revision = account_email_reservations.revision + 1, updated_at = now()`,
        [IDS.alphaAccount, IDS.alphaAdmin],
      );
      await client.query(
        `INSERT INTO users(id, account_id, email, display_name, kind, status)
         VALUES
           ($1, $2, 'recruiter@alpha.local', 'Alpha Recruiter', 'simulated_human', 'active'),
           ($3, $2, 'reviewer@alpha.local', 'Alpha Reviewer', 'simulated_human', 'active'),
           ($4, $5, 'recruiter@beta.local', 'Beta Recruiter', 'simulated_human', 'active'),
           ($6, $2, 'test@gmail.com', 'Test User', 'password_human', 'active')
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           kind = EXCLUDED.kind,
           status = 'active'`,
        [
          IDS.alphaRecruiter,
          IDS.alphaAccount,
          IDS.alphaReviewer,
          IDS.betaRecruiter,
          IDS.betaAccount,
          IDS.alphaAdmin,
        ],
      );
      await client.query(
        `UPDATE users
         SET username = 'test@gmail.com', account_role = 'admin'
         WHERE id = $1 AND account_id = $2`,
        [IDS.alphaAdmin, IDS.alphaAccount],
      );
      await client.query(
        `INSERT INTO password_credentials(
           account_id, user_id, password_scrypt
         ) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, user_id) DO UPDATE SET
           password_scrypt = EXCLUDED.password_scrypt,
           failed_attempts = 0,
           locked_until = NULL,
           password_changed_at = now()`,
        [IDS.alphaAccount, IDS.alphaAdmin, adminPassword],
      );
      await client.query(
        `INSERT INTO capability_grants(
           id, account_id, user_id, capability, status, version, expires_at
         )
         VALUES
           ($1, $2, $3, $7, 'active', 1, '2099-01-01T00:00:00Z'),
           ($4, $2, $5, $7, 'active', 1, '2099-01-01T00:00:00Z'),
           ($6, $8, $9, $7, 'active', 1, '2099-01-01T00:00:00Z')
         ON CONFLICT (account_id, user_id, capability) DO UPDATE SET
           status = 'active',
           revoked_at = NULL,
           revocation_reason = NULL,
           expires_at = EXCLUDED.expires_at,
           version = capability_grants.version + 1`,
        [
          IDS.alphaRecruiterReversalGrant,
          IDS.alphaAccount,
          IDS.alphaRecruiter,
          IDS.alphaReviewerReversalGrant,
          IDS.alphaReviewer,
          IDS.betaReversalGrant,
          SIMULATED_REVERSAL_CAPABILITY,
          IDS.betaAccount,
          IDS.betaRecruiter,
        ],
      );
      await client.query(
        `INSERT INTO capability_grants(
           id, account_id, user_id, capability, status, version, expires_at
         ) VALUES
           ($1, $2, $3, $4, 'active', 1, '2099-01-01T00:00:00Z'),
           ($5, $2, $3, $6, 'active', 1, '2099-01-01T00:00:00Z')
         ON CONFLICT (account_id, user_id, capability) DO UPDATE SET
           status = 'active',
           revoked_at = NULL,
           revocation_reason = NULL,
           expires_at = EXCLUDED.expires_at,
           version = capability_grants.version + 1`,
        [
          IDS.alphaAdminGrant,
          IDS.alphaAccount,
          IDS.alphaAdmin,
          SIMULATED_CAPABILITY,
          IDS.alphaAdminReversalGrant,
          SIMULATED_REVERSAL_CAPABILITY,
        ],
      );
      await client.query(
        `INSERT INTO capability_grants(
           id, account_id, user_id, capability, status, version, expires_at
         )
         VALUES
           ($1, $2, $3, $7, 'active', 1, '2099-01-01T00:00:00Z'),
           ($4, $2, $5, $7, 'active', 1, '2099-01-01T00:00:00Z'),
           ($6, $8, $9, $7, 'active', 1, '2099-01-01T00:00:00Z')
         ON CONFLICT (account_id, user_id, capability) DO UPDATE SET
           status = 'active',
           revoked_at = NULL,
           revocation_reason = NULL,
           expires_at = EXCLUDED.expires_at,
           version = capability_grants.version + 1`,
        [
          IDS.alphaRecruiterGrant,
          IDS.alphaAccount,
          IDS.alphaRecruiter,
          IDS.alphaReviewerGrant,
          IDS.alphaReviewer,
          IDS.betaGrant,
          SIMULATED_CAPABILITY,
          IDS.betaAccount,
          IDS.betaRecruiter,
        ],
      );
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().catch((error: unknown) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}

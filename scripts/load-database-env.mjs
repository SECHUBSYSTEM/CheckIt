import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env") });

const DEFAULT_USER =
  "postgresql://app:app@localhost:5433/users?schema=public";
const DEFAULT_WALLET =
  "postgresql://app:app@localhost:5433/wallets?schema=public";

/**
 * @param {{ warnIfUsingDefaults?: boolean }} [opts]
 */
export function getDatabaseUrls(opts = {}) {
  const warn = opts.warnIfUsingDefaults ?? false;
  const userUrl = process.env.DATABASE_URL_USER ?? DEFAULT_USER;
  const walletUrl = process.env.DATABASE_URL_WALLET ?? DEFAULT_WALLET;

  if (warn && !process.env.DATABASE_URL_USER) {
    console.warn(
      "[prisma] DATABASE_URL_USER not set; using local Docker default.",
    );
  }
  if (warn && !process.env.DATABASE_URL_WALLET) {
    console.warn(
      "[prisma] DATABASE_URL_WALLET not set; using local Docker default.",
    );
  }

  return { root, userUrl, walletUrl };
}

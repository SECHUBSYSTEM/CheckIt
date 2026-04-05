import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getDatabaseUrls } from "./load-database-env.mjs";

const which = process.argv[2];
if (which !== "user" && which !== "wallet") {
  console.error("Usage: node scripts/migrate-dev.mjs <user|wallet>");
  process.exit(1);
}

const { root, userUrl, walletUrl } = getDatabaseUrls({
  warnIfUsingDefaults: true,
});
const packageDir =
  which === "user" ? "packages/prisma-user" : "packages/prisma-wallet";
const databaseUrl = which === "user" ? userUrl : walletUrl;

execSync("pnpm exec prisma migrate dev", {
  cwd: resolve(root, packageDir),
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
  shell: true,
});

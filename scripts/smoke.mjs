/**
 * End-to-end smoke against running user + wallet gRPC servers.
 * Requires grpcurl on PATH: https://github.com/fullstorydev/grpcurl/releases
 *
 * Usage (from repo root, with services up):
 *   pnpm smoke
 *
 * Env overrides:
 *   USER_GRPC_ADDR (default localhost:50051)
 *   WALLET_GRPC_ADDR (default localhost:50052)
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protoImport = join(root, "packages", "proto", "proto");

const userAddr = process.env.USER_GRPC_ADDR ?? "localhost:50051";
const walletAddr = process.env.WALLET_GRPC_ADDR ?? "localhost:50052";

function runGrpcurl(args) {
  const r = spawnSync("grpcurl", args, {
    encoding: "utf8",
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error) {
    console.error(
      "grpcurl failed to start. Install: https://github.com/fullstorydev/grpcurl/releases",
    );
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || "grpcurl exited non-zero");
    process.exit(r.status ?? 1);
  }
  return r.stdout;
}

function grpcJson(protoFile, addr, fullMethod, jsonBody) {
  const out = runGrpcurl([
    "-plaintext",
    "-import-path",
    protoImport,
    "-proto",
    protoFile,
    "-d",
    jsonBody,
    "-format",
    "json",
    addr,
    fullMethod,
  ]);
  return JSON.parse(out.trim() || "{}");
}

console.log("Smoke: proto import path:", protoImport);
console.log("Smoke: user @", userAddr, "| wallet @", walletAddr);

const createRes = grpcJson(
  "user/v1/user.proto",
  userAddr,
  "user.v1.UserService/CreateUser",
  JSON.stringify({
    email: `smoke-${Date.now()}@example.com`,
    name: "Smoke Test",
  }),
);

const userId = createRes.user?.id;
if (!userId) {
  console.error("CreateUser did not return user.id:", createRes);
  process.exit(1);
}
console.log("CreateUser ok, userId:", userId);

grpcJson(
  "user/v1/user.proto",
  userAddr,
  "user.v1.UserService/GetUserById",
  JSON.stringify({ userId }),
);
console.log("GetUserById ok");

grpcJson(
  "wallet/v1/wallet.proto",
  walletAddr,
  "wallet.v1.WalletService/CreateWallet",
  JSON.stringify({ userId, idempotencyKey: `smoke-create-${Date.now()}` }),
);
console.log("CreateWallet ok (idempotent if exists)");

let w = grpcJson(
  "wallet/v1/wallet.proto",
  walletAddr,
  "wallet.v1.WalletService/GetWallet",
  JSON.stringify({ userId }),
);
console.log("GetWallet balance:", w.wallet?.balanceMinorUnits);

grpcJson(
  "wallet/v1/wallet.proto",
  walletAddr,
  "wallet.v1.WalletService/CreditWallet",
  JSON.stringify({
    userId,
    amountMinorUnits: 500,
    idempotencyKey: `smoke-credit-${Date.now()}`,
  }),
);
console.log("CreditWallet +500 ok");

grpcJson(
  "wallet/v1/wallet.proto",
  walletAddr,
  "wallet.v1.WalletService/DebitWallet",
  JSON.stringify({
    userId,
    amountMinorUnits: 100,
    idempotencyKey: `smoke-debit-${Date.now()}`,
  }),
);
console.log("DebitWallet -100 ok");

w = grpcJson(
  "wallet/v1/wallet.proto",
  walletAddr,
  "wallet.v1.WalletService/GetWallet",
  JSON.stringify({ userId }),
);
const bal = w.wallet?.balanceMinorUnits;
if (bal !== 400) {
  console.error("Expected balance 400 after credit/debit, got:", bal, w);
  process.exit(1);
}
console.log("Final balance 400 ok — smoke passed.");

# Backend assessment: user and wallet services

NestJS gRPC microservices, Prisma, PostgreSQL, pnpm monorepo.

- **User service** (`apps/user-service`): `CreateUser`, `GetUserById`; creates a wallet via the wallet service after each new user.
- **Wallet service** (`apps/wallet-service`): `CreateWallet`, `GetWallet`, `CreditWallet`, `DebitWallet`; verifies users with `GetUserById` before wallet creation; idempotency and `SERIALIZABLE` transactions on mutations.

### Atomic debits and transactions

`CreditWallet`, `DebitWallet`, and wallet creation each run in a **Prisma `$transaction`** with **`TransactionIsolationLevel.Serializable`** (PostgreSQL `SERIALIZABLE`).

- **Debit:** the balance change is a single **`updateMany`** with `where: { id: wallet.id, balance: { gte: amount } }` and `balance: { decrement: amount }`. The database applies that as **one atomic UPDATE**: either the row qualifies and the balance decreases, or no row is updated (insufficient funds) and the handler returns **`FAILED_PRECONDITION`** without a partial debit. Serializable isolation reduces lost updates when two debits race on the same wallet.
- **Credit:** `increment` on the wallet row and insert into **`processed_wallet_requests`** happen in the **same** transaction so balance and idempotency ledger stay aligned.
- **Idempotency races:** if two requests share the same idempotency key and both pass the in-transaction duplicate check, the second insert can hit **P2002**; the service **re-reads** the committed idempotency row and returns the same outcome (or **`INVALID_ARGUMENT`** if amounts differ). Unclassified Prisma or unexpected errors are mapped to **`RpcException`** (`INTERNAL` / `ABORTED` / `NOT_FOUND` where appropriate) instead of leaking raw errors to gRPC clients.

Amounts must be **finite positive integers** at most **`Number.MAX_SAFE_INTEGER`** before conversion to `bigint`; non-finite values, fractions, and overflow are rejected with **`INVALID_ARGUMENT`** or **`OUT_OF_RANGE`**.

## Requirements

- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL during local development)

## Protocol buffers

Source `.proto` files live under `packages/proto/proto`. Regenerate TypeScript with [Buf](https://buf.build/) (remote `ts-proto` plugin; requires network):

```bash
pnpm proto:generate
```

## Database

PostgreSQL runs via Docker (two databases: `users`, `wallets`). The compose file maps **host port 5433** to Postgres 5432 so it does not clash with a local PostgreSQL on 5432.

```bash
cp .env.example .env   # optional: overrides default local URLs below
pnpm db:up
```

Apply migrations from the **repo root**. Scripts inject `DATABASE_URL` per package from `DATABASE_URL_USER` and `DATABASE_URL_WALLET` in `.env`. If those are unset, the defaults match Docker Compose (`localhost:5433`).

```bash
pnpm migrate:deploy
```

Interactive migrations (dev):

```bash
pnpm migrate:user
pnpm migrate:wallet
```

Generate Prisma clients (each package writes to its own `src/generated/client`):

```bash
pnpm prisma:generate
```

## Lint, typecheck, tests

From the **repository root** (after `pnpm install` and `pnpm prisma:generate` so Prisma packages typecheck):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:cov
```

| Command | What it checks |
|---------|----------------|
| `pnpm lint` | ESLint on TypeScript sources (excludes generated Prisma clients and build output). |
| `pnpm typecheck` | `tsc --noEmit` in proto, Prisma packages, and both Nest apps. |
| `pnpm test` | Jest **unit** tests (mocked DB and cross-service calls; **no** PostgreSQL required). |
| `pnpm test:cov` | Same as `test`, plus coverage reports under `apps/user-service/coverage/` and `apps/wallet-service/coverage/`. |

**Why Jest does not talk to PostgreSQL:** each spec file replaces Nest’s `PrismaService` (and the cross-service gRPC clients) with plain objects whose methods are **`jest.fn()` mocks**. When a test calls `createUser`, the code under test invokes `prisma.user.create`, but that resolves to whatever the test configured (for example `mockResolvedValue({ id: "…" })`)—no `DATABASE_URL`, no TCP connection, and no real Prisma engine. That keeps tests fast and deterministic; **`pnpm smoke`** is the place that exercises a real DB and both gRPC servers together.

**Success:** `pnpm lint` and `pnpm typecheck` exit with code 0; `pnpm test` prints all suites **PASS** with no failures (user and wallet apps each run their own Jest project).

**What the unit tests cover** (service logic only; gRPC controllers and live wiring are not duplicated here):

- **User** (`apps/user-service/src/user/user.service.spec.ts`): valid create + wallet provisioning; validation errors; duplicate email → `ALREADY_EXISTS`; other Prisma / unexpected errors → `INTERNAL`; wallet failure → user deleted + `RpcException`; `getUserById` happy path, blank id, missing user.
- **Wallet** (`apps/wallet-service/src/wallet/wallet.service.spec.ts`): create/get/credit/debit validation; strict amount rules (finite, integer, ≤ `MAX_SAFE_INTEGER`); user lookup failure; existing wallet and idempotency paths (P2002 recovery when a wallet row appears; prior idempotency row; unresolved create race → `ABORTED`; credit/debit idempotency insert race → recovery); idempotency replay and amount mismatch; insufficient balance; unsafe `bigint` on read; orphan idempotency rows → `NOT_FOUND`; stray transaction errors → `INTERNAL`.

**What is not meant to be “complete” in Jest:** gRPC controllers, real Prisma query serialization, `SERIALIZABLE` concurrency against Postgres, or every possible Prisma/network failure inside `creditWallet` / `debitWallet` transactions (those surface as thrown errors from `$transaction` in production). **`pnpm smoke`** plus manual or CI runs against Docker Postgres cover integration behavior.

**End-to-end check (real DB + both servers):** after `pnpm db:up`, `pnpm migrate:deploy`, and starting wallet then user, run **`pnpm smoke`** (requires [grpcurl](https://github.com/fullstorydev/grpcurl)); that complements Jest by hitting the running services.

Per app: `pnpm --filter @apps/user-service test` / `test:cov` / `lint` / `typecheck` (same for `@apps/wallet-service`).

### Prisma ORM version

This repo uses **Prisma ORM 6.19.3**. **Prisma ORM 7** currently supports Node.js **20.19+**, **22.12+**, or **24+** only (Node 23 is not supported by the v7 installer). Upgrade to v7 after moving to a supported Node release.

### Migrations

`pnpm migrate:deploy` runs `scripts/migrate-deploy.mjs`, which sets `DATABASE_URL` for each Prisma package. To run Prisma CLI directly inside a package, create that package’s `.env` with a single `DATABASE_URL` (see each package’s `.env.example`).

## Run services

From the **repository root**, copy `.env.example` to `.env` (or rely on migrate scripts’ defaults for Postgres only). Ensure `pnpm prisma:generate` and `pnpm migrate:deploy` have been run and `pnpm db:up` is healthy.

**Start the wallet service before the user service** (user creation calls wallet over gRPC).

```bash
# terminal 1
pnpm dev:wallet

# terminal 2
pnpm dev:user
```

Ports default to **50052** (wallet) and **50051** (user); override with `WALLET_GRPC_PORT` / `USER_GRPC_PORT` in `.env`.

If `nest start` is launched with a working directory other than `apps/*-service`, set `REPO_ROOT` to the monorepo root so `.proto` files resolve.

## Example `grpcurl` calls

Install [grpcurl](https://github.com/fullstorydev/grpcurl). Run from the repo root; replace `USER_ID` with the `id` returned from `CreateUser`.

```bash
set ROOT=%CD%
grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto user/v1/user.proto -d "{\"email\":\"alice@example.com\",\"name\":\"Alice\"}" localhost:50051 user.v1.UserService/CreateUser

grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto user/v1/user.proto -d "{\"userId\":\"USER_ID\"}" localhost:50051 user.v1.UserService/GetUserById

grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto wallet/v1/wallet.proto -d "{\"userId\":\"USER_ID\",\"idempotencyKey\":\"w1\"}" localhost:50052 wallet.v1.WalletService/CreateWallet

grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto wallet/v1/wallet.proto -d "{\"userId\":\"USER_ID\"}" localhost:50052 wallet.v1.WalletService/GetWallet

grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto wallet/v1/wallet.proto -d "{\"userId\":\"USER_ID\",\"amountMinorUnits\":1000,\"idempotencyKey\":\"c1\"}" localhost:50052 wallet.v1.WalletService/CreditWallet

grpcurl -plaintext -import-path "%ROOT%\packages\proto\proto" -proto wallet/v1/wallet.proto -d "{\"userId\":\"USER_ID\",\"amountMinorUnits\":250,\"idempotencyKey\":\"d1\"}" localhost:50052 wallet.v1.WalletService/DebitWallet
```

On PowerShell, escape JSON differently, for example:

```powershell
grpcurl -plaintext -import-path "$PWD\packages\proto\proto" -proto user/v1/user.proto -d '{"email":"alice@example.com","name":"Alice"}' localhost:50051 user.v1.UserService/CreateUser
```

## Smoke test (grpcurl)

With **wallet** and **user** services running and [grpcurl](https://github.com/fullstorydev/grpcurl) on your `PATH`:

```bash
pnpm smoke
```

This creates a user, hits all wallet RPCs, and asserts a final balance of **400** minor units (after +500 and −100 credits). Override addresses with `USER_GRPC_ADDR` and `WALLET_GRPC_ADDR` if needed.

## Postman (gRPC)

The collection includes **every RPC** in this repo (six methods total—two on **UserService**, four on **WalletService**). There are no separate REST endpoints.

1. Import **`postman/CheckIt.postman_collection.json`** and **`postman/CheckIt.postman_environment.json`**, then select the **CheckIt local** environment.
2. Attach **protobuf** definitions: add import path **`packages/proto/proto`**, then for user requests use **`user/v1/user.proto`**, for wallet requests **`wallet/v1/wallet.proto`** (wording varies slightly by Postman version).
3. Start **wallet** then **user** services. URLs: **`user_grpc_url`** `grpc://localhost:50051`, **`wallet_grpc_url`** `grpc://localhost:50052`.
4. Run **`1. CreateUser`** first. Its **Tests** script saves **`user.id`** into **`user_id`** (environment + collection). **CreateUser** uses a timestamped email to avoid duplicate-email errors on repeat runs. Then run **GetUserById** and the wallet methods (**CreateWallet**, **GetWallet**, **CreditWallet**, **DebitWallet**). JSON uses camelCase like `grpcurl` (`userId`, `idempotencyKey`, `amountMinorUnits`). If the script does not run, paste `user.id` into **`user_id`** manually.

## Assessment checklist

| Item | Location / notes |
|------|------------------|
| Monorepo layout | `apps/user-service`, `apps/wallet-service`, `packages/proto`, `packages/prisma-user`, `packages/prisma-wallet` |
| User gRPC | `CreateUser`, `GetUserById` |
| Wallet gRPC | `CreateWallet`, `GetWallet`, `CreditWallet`, `DebitWallet` |
| Cross-service calls | Wallet → `GetUserById` before wallet create; User → `CreateWallet` after user create |
| PostgreSQL + Prisma | Two DBs via Docker; migrations under each `prisma/migrations` |
| Idempotency + transactions | `processed_wallet_requests`; `SERIALIZABLE` + conditional debit |
| Validation | `class-validator` on user create |
| Logging | `nestjs-pino` in both apps |
| Example requests | `grpcurl` blocks above; `pnpm smoke`; Postman collection + env + proto import |
| Quality | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:cov` |

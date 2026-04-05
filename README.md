# Backend assessment: user and wallet services

NestJS gRPC microservices, Prisma, PostgreSQL, pnpm monorepo.

- **User service** (`apps/user-service`): `CreateUser`, `GetUserById`; creates a wallet via the wallet service after each new user.
- **Wallet service** (`apps/wallet-service`): `CreateWallet`, `GetWallet`, `CreditWallet`, `DebitWallet`; verifies users with `GetUserById` before wallet creation; idempotency and `SERIALIZABLE` transactions on mutations.

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

Postman can call gRPC directly:

1. Import the environment `postman/CheckIt.postman_environment.json` (variables `userGrpc`, `walletGrpc`).
2. New request → **gRPC** → server `{{userGrpc}}` or `{{walletGrpc}}`.
3. **Import** → select `packages/proto/proto/user/v1/user.proto` or `wallet/v1/wallet.proto`.
4. Choose the service method (for example `user.v1.UserService` / `CreateUser`) and send a JSON body matching the message (camelCase field names).

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
| Example requests | `grpcurl` blocks above; `pnpm smoke`; Postman env + proto import |

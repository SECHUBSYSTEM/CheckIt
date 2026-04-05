# Backend assessment: user and wallet services

NestJS microservices (gRPC), Prisma, PostgreSQL, monorepo.

Setup and run instructions will be added as the services are implemented.

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
cp .env.example .env
pnpm db:up
```

Apply migrations (from repo root, with `DATABASE_URL` set for each package — copy each package `.env.example` into `packages/prisma-user/.env` and `packages/prisma-wallet/.env`, or export `DATABASE_URL` before running):

```bash
pnpm migrate:user
pnpm migrate:wallet
```

Generate Prisma clients (each package writes to its own `src/generated/client`; run both):

```bash
pnpm prisma:generate
```

### Prisma ORM version

This repo uses **Prisma ORM 6.19.3**. **Prisma ORM 7** currently supports Node.js **20.19+**, **22.12+**, or **24+** only (Node 23 is not supported by the v7 installer). Upgrade to v7 after moving to a supported Node release.

### Migrations

Production-style apply (no prompts):

```bash
pnpm migrate:deploy
```

Or per package: `pnpm --filter @packages/prisma-user exec prisma migrate dev` and `pnpm --filter @packages/prisma-wallet exec prisma migrate dev`.

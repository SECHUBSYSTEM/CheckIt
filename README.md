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

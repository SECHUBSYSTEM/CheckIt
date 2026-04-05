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

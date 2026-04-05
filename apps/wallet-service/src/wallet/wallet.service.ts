import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@packages/prisma-wallet";
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  CreditWalletRequest,
  CreditWalletResponse,
  DebitWalletRequest,
  DebitWalletResponse,
  GetWalletRequest,
  GetWalletResponse,
  Wallet as ProtoWallet,
} from "@packages/proto";
import { ServiceError, status } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { UserClientService } from "../user-client/user-client.service";

const KIND_CREATE = "WALLET_CREATE";
const KIND_CREDIT = "CREDIT";
const KIND_DEBIT = "DEBIT";

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserClientService,
  ) {}

  private bigintToProtoInt64(n: bigint): number {
    const x = Number(n);
    if (!Number.isSafeInteger(x)) {
      throw new RpcException({
        code: status.OUT_OF_RANGE,
        message: "Amount or balance exceeds Number.MAX_SAFE_INTEGER for this API",
      });
    }
    return x;
  }

  private mapWallet(row: {
    id: string;
    userId: string;
    balance: bigint;
    createdAt: Date;
  }): ProtoWallet {
    return {
      id: row.id,
      userId: row.userId,
      balanceMinorUnits: this.bigintToProtoInt64(row.balance),
      createdAtUnixMs: row.createdAt.getTime(),
    };
  }

  private requireIdempotencyKey(key: string | undefined): string {
    const k = key?.trim() ?? "";
    if (!k) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "idempotencyKey is required",
      });
    }
    return k;
  }

  private parsePositiveMinorUnits(value: number | undefined): bigint {
    if (value === undefined || value === null) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "amount_minor_units is required",
      });
    }
    const n = BigInt(Math.trunc(value));
    if (n <= 0n) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "amount_minor_units must be a positive integer",
      });
    }
    return n;
  }

  async createWallet(data: CreateWalletRequest): Promise<CreateWalletResponse> {
    const idempotencyKey = this.requireIdempotencyKey(data.idempotencyKey);
    if (!data.userId?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "userId is required",
      });
    }

    try {
      await this.users.getUserById({ userId: data.userId });
    } catch (e: unknown) {
      const err = e as ServiceError;
      throw new RpcException({
        code: err.code ?? status.NOT_FOUND,
        message: err.message ?? "User not found",
      });
    }

    const existing = await this.prisma.wallet.findUnique({
      where: { userId: data.userId },
    });
    if (existing) {
      return { wallet: this.mapWallet(existing) };
    }

    const prior = await this.prisma.processedWalletRequest.findUnique({
      where: {
        userId_idempotencyKey_kind: {
          userId: data.userId,
          idempotencyKey,
          kind: KIND_CREATE,
        },
      },
    });
    if (prior?.walletId) {
      const w = await this.prisma.wallet.findUnique({
        where: { id: prior.walletId },
      });
      if (w) {
        return { wallet: this.mapWallet(w) };
      }
    }

    try {
      const wallet = await this.prisma.$transaction(
        async (tx) => {
          const w = await tx.wallet.create({
            data: { userId: data.userId, balance: 0n },
          });
          await tx.processedWalletRequest.create({
            data: {
              userId: data.userId,
              idempotencyKey,
              kind: KIND_CREATE,
              walletId: w.id,
              balanceAfterMinorUnits: 0n,
            },
          });
          return w;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      return { wallet: this.mapWallet(wallet) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const w = await this.prisma.wallet.findUnique({
          where: { userId: data.userId },
        });
        if (w) {
          return { wallet: this.mapWallet(w) };
        }
      }
      throw e;
    }
  }

  async getWallet(data: GetWalletRequest): Promise<GetWalletResponse> {
    if (!data.userId?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "userId is required",
      });
    }
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: data.userId },
    });
    if (!wallet) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: "Wallet not found",
      });
    }
    return { wallet: this.mapWallet(wallet) };
  }

  async creditWallet(data: CreditWalletRequest): Promise<CreditWalletResponse> {
    const idempotencyKey = this.requireIdempotencyKey(data.idempotencyKey);
    if (!data.userId?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "userId is required",
      });
    }
    const amount = this.parsePositiveMinorUnits(data.amountMinorUnits);

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.processedWalletRequest.findUnique({
          where: {
            userId_idempotencyKey_kind: {
              userId: data.userId,
              idempotencyKey,
              kind: KIND_CREDIT,
            },
          },
        });
        if (existing) {
          if (existing.amountMinorUnits !== amount) {
            throw new RpcException({
              code: status.INVALID_ARGUMENT,
              message:
                "Idempotency key already used with a different amount_minor_units",
            });
          }
          const w = await tx.wallet.findUnique({
            where: { userId: data.userId },
          });
          if (!w) {
            throw new RpcException({
              code: status.NOT_FOUND,
              message: "Wallet not found",
            });
          }
          return { wallet: this.mapWallet(w) };
        }

        const wallet = await tx.wallet.findUnique({
          where: { userId: data.userId },
        });
        if (!wallet) {
          throw new RpcException({
            code: status.NOT_FOUND,
            message: "Wallet not found",
          });
        }

        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: amount } },
        });

        await tx.processedWalletRequest.create({
          data: {
            userId: data.userId,
            idempotencyKey,
            kind: KIND_CREDIT,
            walletId: wallet.id,
            amountMinorUnits: amount,
            balanceAfterMinorUnits: updated.balance,
          },
        });

        return { wallet: this.mapWallet(updated) };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async debitWallet(data: DebitWalletRequest): Promise<DebitWalletResponse> {
    const idempotencyKey = this.requireIdempotencyKey(data.idempotencyKey);
    if (!data.userId?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "userId is required",
      });
    }
    const amount = this.parsePositiveMinorUnits(data.amountMinorUnits);

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.processedWalletRequest.findUnique({
          where: {
            userId_idempotencyKey_kind: {
              userId: data.userId,
              idempotencyKey,
              kind: KIND_DEBIT,
            },
          },
        });
        if (existing) {
          if (existing.amountMinorUnits !== amount) {
            throw new RpcException({
              code: status.INVALID_ARGUMENT,
              message:
                "Idempotency key already used with a different amount_minor_units",
            });
          }
          const w = await tx.wallet.findUnique({
            where: { userId: data.userId },
          });
          if (!w) {
            throw new RpcException({
              code: status.NOT_FOUND,
              message: "Wallet not found",
            });
          }
          return { wallet: this.mapWallet(w) };
        }

        const wallet = await tx.wallet.findUnique({
          where: { userId: data.userId },
        });
        if (!wallet) {
          throw new RpcException({
            code: status.NOT_FOUND,
            message: "Wallet not found",
          });
        }

        const debited = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });

        if (debited.count === 0) {
          throw new RpcException({
            code: status.FAILED_PRECONDITION,
            message: "Insufficient balance",
          });
        }

        const updated = await tx.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
        });

        await tx.processedWalletRequest.create({
          data: {
            userId: data.userId,
            idempotencyKey,
            kind: KIND_DEBIT,
            walletId: wallet.id,
            amountMinorUnits: amount,
            balanceAfterMinorUnits: updated.balance,
          },
        });

        return { wallet: this.mapWallet(updated) };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}

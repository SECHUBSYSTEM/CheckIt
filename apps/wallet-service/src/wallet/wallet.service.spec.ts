import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@packages/prisma-wallet";
import { status } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { UserClientService } from "../user-client/user-client.service";
import { WalletService } from "./wallet.service";

describe("WalletService", () => {
  let service: WalletService;
  let prisma: {
    wallet: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    processedWalletRequest: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let users: { getUserById: jest.Mock };

  const userId = "11111111-1111-1111-1111-111111111111";
  const walletId = "22222222-2222-2222-2222-222222222222";
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  const walletZero = {
    id: walletId,
    userId,
    balance: 0n,
    createdAt,
  };

  beforeEach(async () => {
    users = {
      getUserById: jest.fn().mockResolvedValue({ user: { id: userId } }),
    };

    prisma = {
      wallet: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      processedWalletRequest: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserClientService, useValue: users },
      ],
    }).compile();

    service = module.get(WalletService);
  });

  describe("createWallet", () => {
    it("requires idempotencyKey", async () => {
      await expect(
        service.createWallet({ userId, idempotencyKey: "" }),
      ).rejects.toThrow(RpcException);
      await expect(
        service.createWallet({ userId, idempotencyKey: "   " }),
      ).rejects.toThrow(RpcException);
    });

    it("requires userId", async () => {
      await expect(
        service.createWallet({ userId: "", idempotencyKey: "k1" }),
      ).rejects.toThrow(RpcException);
    });

    it("propagates user lookup failure", async () => {
      users.getUserById.mockRejectedValue(
        Object.assign(new Error("not found"), { code: status.NOT_FOUND }),
      );

      await expect(
        service.createWallet({ userId, idempotencyKey: "k1" }),
      ).rejects.toThrow(RpcException);
    });

    it("returns existing wallet without transaction", async () => {
      prisma.wallet.findUnique.mockResolvedValue(walletZero);

      const res = await service.createWallet({
        userId,
        idempotencyKey: "k1",
      });

      expect(res.wallet?.id).toBe(walletId);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("creates wallet and idempotency row in transaction", async () => {
      prisma.wallet.findUnique.mockResolvedValueOnce(null);
      prisma.processedWalletRequest.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            wallet: {
              create: jest.fn().mockResolvedValue(walletZero),
            },
            processedWalletRequest: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        },
      );

      const res = await service.createWallet({
        userId,
        idempotencyKey: "new-key",
      });

      expect(res.wallet?.userId).toBe(userId);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("recovers from P2002 race by returning wallet", async () => {
      prisma.wallet.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(walletZero);
      prisma.processedWalletRequest.findUnique.mockResolvedValue(null);
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      });
      prisma.$transaction.mockRejectedValue(dup);

      const res = await service.createWallet({
        userId,
        idempotencyKey: "race",
      });

      expect(res.wallet?.id).toBe(walletId);
    });

    it("returns wallet from prior idempotency row without starting a new transaction", async () => {
      prisma.wallet.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(walletZero);
      prisma.processedWalletRequest.findUnique.mockResolvedValue({
        walletId,
      });

      const res = await service.createWallet({
        userId,
        idempotencyKey: "replay-create",
      });

      expect(res.wallet?.id).toBe(walletId);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("maps unresolved P2002 after create race to ABORTED for client retry", async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.processedWalletRequest.findUnique.mockResolvedValue(null);
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      });
      prisma.$transaction.mockRejectedValue(dup);

      try {
        await service.createWallet({ userId, idempotencyKey: "race-no-row" });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.ABORTED);
      }
    });
  });

  describe("getWallet", () => {
    it("requires userId", async () => {
      await expect(service.getWallet({ userId: "" })).rejects.toThrow(
        RpcException,
      );
    });

    it("NOT_FOUND when no wallet", async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);
      await expect(service.getWallet({ userId })).rejects.toThrow(RpcException);
    });

    it("maps wallet including balance", async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        ...walletZero,
        balance: 99n,
      });
      const res = await service.getWallet({ userId });
      expect(res.wallet?.balanceMinorUnits).toBe(99);
    });

    it("throws OUT_OF_RANGE when balance is not a safe integer", async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        ...walletZero,
        balance: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
      });
      try {
        await service.getWallet({ userId });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.OUT_OF_RANGE);
      }
    });
  });

  describe("creditWallet", () => {
    it("requires idempotency key", async () => {
      await expect(
        service.creditWallet({
          userId,
          amountMinorUnits: 1,
          idempotencyKey: "  ",
        }),
      ).rejects.toThrow(RpcException);
    });

    it("requires userId", async () => {
      await expect(
        service.creditWallet({
          userId: "",
          amountMinorUnits: 1,
          idempotencyKey: "k",
        }),
      ).rejects.toThrow(RpcException);
    });

    it("rejects missing amount_minor_units", async () => {
      try {
        await service.creditWallet({
          userId,
          idempotencyKey: "need-amount",
        } as Parameters<WalletService["creditWallet"]>[0]);
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INVALID_ARGUMENT);
      }
    });

    it("requires positive amount", async () => {
      await expect(
        service.creditWallet({
          userId,
          amountMinorUnits: 0,
          idempotencyKey: "c",
        }),
      ).rejects.toThrow(RpcException);
      await expect(
        service.creditWallet({
          userId,
          amountMinorUnits: -5,
          idempotencyKey: "c",
        }),
      ).rejects.toThrow(RpcException);
    });

    it("rejects non-finite and non-integer amounts", async () => {
      for (const bad of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 10.5]) {
        await expect(
          service.creditWallet({
            userId,
            amountMinorUnits: bad,
            idempotencyKey: "bad-amt",
          }),
        ).rejects.toThrow(RpcException);
      }
    });

    it("rejects amounts above Number.MAX_SAFE_INTEGER", async () => {
      try {
        await service.creditWallet({
          userId,
          amountMinorUnits: Number.MAX_SAFE_INTEGER + 2,
          idempotencyKey: "big",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.OUT_OF_RANGE);
      }
    });

    it("recovers from P2002 when idempotency insert races on credit", async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
      prisma.processedWalletRequest.findUnique.mockResolvedValue({
        amountMinorUnits: 30n,
      });
      prisma.wallet.findUnique.mockResolvedValue({
        ...walletZero,
        balance: 130n,
      });

      const res = await service.creditWallet({
        userId,
        amountMinorUnits: 30,
        idempotencyKey: "race-credit",
      });
      expect(res.wallet?.balanceMinorUnits).toBe(130);
    });

    it("maps unexpected transaction errors to INTERNAL", async () => {
      prisma.$transaction.mockRejectedValue(new Error("db down"));

      try {
        await service.creditWallet({
          userId,
          amountMinorUnits: 1,
          idempotencyKey: "e",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INTERNAL);
      }
    });

    it("NOT_FOUND when wallet missing", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            wallet: { findUnique: jest.fn().mockResolvedValue(null) },
          };
          return fn(tx);
        },
      );

      await expect(
        service.creditWallet({
          userId,
          amountMinorUnits: 10,
          idempotencyKey: "c1",
        }),
      ).rejects.toThrow(RpcException);
    });

    it("credits balance and records idempotency", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({}),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue(walletZero),
              update: jest.fn().mockResolvedValue({
                ...walletZero,
                balance: 50n,
              }),
            },
          };
          return fn(tx);
        },
      );

      const res = await service.creditWallet({
        userId,
        amountMinorUnits: 50,
        idempotencyKey: "credit-once",
      });

      expect(res.wallet?.balanceMinorUnits).toBe(50);
    });

    it("replays idempotent credit with same amount", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue({
                amountMinorUnits: 50n,
              }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue({
                ...walletZero,
                balance: 50n,
              }),
            },
          };
          return fn(tx);
        },
      );

      const res = await service.creditWallet({
        userId,
        amountMinorUnits: 50,
        idempotencyKey: "same",
      });
      expect(res.wallet?.balanceMinorUnits).toBe(50);
    });

    it("NOT_FOUND on idempotent credit replay when wallet row missing", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue({
                amountMinorUnits: 10n,
              }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          };
          return fn(tx);
        },
      );

      try {
        await service.creditWallet({
          userId,
          amountMinorUnits: 10,
          idempotencyKey: "orphan-credit",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.NOT_FOUND);
      }
    });

    it("rejects idempotent credit with different amount", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue({
                amountMinorUnits: 10n,
              }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue(walletZero),
            },
          };
          return fn(tx);
        },
      );

      await expect(
        service.creditWallet({
          userId,
          amountMinorUnits: 50,
          idempotencyKey: "mismatch",
        }),
      ).rejects.toThrow(RpcException);
    });
  });

  describe("debitWallet", () => {
    it("requires idempotency key and userId", async () => {
      await expect(
        service.debitWallet({
          userId,
          amountMinorUnits: 1,
          idempotencyKey: "",
        }),
      ).rejects.toThrow(RpcException);
      await expect(
        service.debitWallet({
          userId: " ",
          amountMinorUnits: 1,
          idempotencyKey: "k",
        }),
      ).rejects.toThrow(RpcException);
    });

    it("fails when insufficient balance", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
            wallet: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ ...walletZero, balance: 5n }),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          };
          return fn(tx);
        },
      );

      try {
        await service.debitWallet({
          userId,
          amountMinorUnits: 10,
          idempotencyKey: "d1",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.FAILED_PRECONDITION);
      }
    });

    it("replays idempotent debit with same amount", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ amountMinorUnits: 20n }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue({
                ...walletZero,
                balance: 80n,
              }),
            },
          };
          return fn(tx);
        },
      );

      const res = await service.debitWallet({
        userId,
        amountMinorUnits: 20,
        idempotencyKey: "debit-repeat",
      });
      expect(res.wallet?.balanceMinorUnits).toBe(80);
    });

    it("debits when sufficient balance", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({}),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue({
                ...walletZero,
                balance: 100n,
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...walletZero,
                balance: 40n,
              }),
            },
          };
          return fn(tx);
        },
      );

      const res = await service.debitWallet({
        userId,
        amountMinorUnits: 60,
        idempotencyKey: "d-ok",
      });
      expect(res.wallet?.balanceMinorUnits).toBe(40);
    });

    it("NOT_FOUND on idempotent debit replay when wallet row missing", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue({
                amountMinorUnits: 10n,
              }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue(null),
            },
          };
          return fn(tx);
        },
      );

      try {
        await service.debitWallet({
          userId,
          amountMinorUnits: 10,
          idempotencyKey: "orphan-debit",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.NOT_FOUND);
      }
    });

    it("recovers from P2002 when idempotency insert races on debit", async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
      prisma.processedWalletRequest.findUnique.mockResolvedValue({
        amountMinorUnits: 15n,
      });
      prisma.wallet.findUnique.mockResolvedValue({
        ...walletZero,
        balance: 85n,
      });

      const res = await service.debitWallet({
        userId,
        amountMinorUnits: 15,
        idempotencyKey: "race-debit",
      });
      expect(res.wallet?.balanceMinorUnits).toBe(85);
    });

    it("rejects idempotent debit amount mismatch", async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => {
          const tx = {
            processedWalletRequest: {
              findUnique: jest.fn().mockResolvedValue({
                amountMinorUnits: 5n,
              }),
            },
            wallet: {
              findUnique: jest.fn().mockResolvedValue(walletZero),
            },
          };
          return fn(tx);
        },
      );

      await expect(
        service.debitWallet({
          userId,
          amountMinorUnits: 10,
          idempotencyKey: "bad",
        }),
      ).rejects.toThrow(RpcException);
    });
  });
});

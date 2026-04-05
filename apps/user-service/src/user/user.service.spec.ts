import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@packages/prisma-user";
import { status } from "@grpc/grpc-js";
import { PrismaService } from "../prisma/prisma.service";
import { WalletClientService } from "../wallet-client/wallet-client.service";
import { UserService } from "./user.service";

describe("UserService", () => {
  let service: UserService;
  let prisma: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let walletClient: { createWallet: jest.Mock };

  const createdUser = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "ok@example.com",
    name: "Ok User",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    walletClient = { createWallet: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: WalletClientService, useValue: walletClient },
      ],
    }).compile();

    service = module.get(UserService);
  });

  describe("createUser", () => {
    it("creates user and provisions wallet", async () => {
      prisma.user.create.mockResolvedValue(createdUser);

      const res = await service.createUser({
        email: "ok@example.com",
        name: "Ok User",
      });

      expect(res.user?.id).toBe(createdUser.id);
      expect(res.user?.email).toBe("ok@example.com");
      expect(walletClient.createWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: createdUser.id,
          idempotencyKey: expect.any(String),
        }),
      );
    });

    it("rejects invalid email", async () => {
      try {
        await service.createUser({ email: "not-an-email", name: "x" });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INVALID_ARGUMENT);
      }
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("rejects empty name", async () => {
      await expect(
        service.createUser({ email: "a@b.co", name: "" }),
      ).rejects.toThrow(RpcException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("maps unexpected errors from create to INTERNAL", async () => {
      prisma.user.create.mockRejectedValue(new Error("db unavailable"));

      try {
        await service.createUser({ email: "x@y.co", name: "X" });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INTERNAL);
      }
    });

    it("maps non-duplicate Prisma errors from create to INTERNAL", async () => {
      const prismaErr = new Prisma.PrismaClientKnownRequestError("timeout", {
        code: "P1008",
        clientVersion: "test",
      });
      prisma.user.create.mockRejectedValue(prismaErr);

      try {
        await service.createUser({ email: "x@y.co", name: "X" });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INTERNAL);
      }
    });

    it("maps duplicate email to ALREADY_EXISTS", async () => {
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      });
      prisma.user.create.mockRejectedValue(dup);

      try {
        await service.createUser({ email: "dup@example.com", name: "Dup" });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.ALREADY_EXISTS);
      }
    });

    it("rolls back user when wallet service fails", async () => {
      prisma.user.create.mockResolvedValue(createdUser);
      const grpcErr = Object.assign(new Error("unavailable"), {
        code: status.UNAVAILABLE,
      });
      walletClient.createWallet.mockRejectedValue(grpcErr);

      await expect(
        service.createUser({ email: "ok@example.com", name: "Ok User" }),
      ).rejects.toThrow(RpcException);

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: createdUser.id },
      });
    });
  });

  describe("getUserById", () => {
    it("returns user when found", async () => {
      prisma.user.findUnique.mockResolvedValue(createdUser);

      const res = await service.getUserById({
        userId: createdUser.id,
      });

      expect(res.user?.id).toBe(createdUser.id);
    });

    it("rejects blank userId", async () => {
      try {
        await service.getUserById({ userId: "   " });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.INVALID_ARGUMENT);
      }
    });

    it("returns NOT_FOUND when missing", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      try {
        await service.getUserById({
          userId: "22222222-2222-2222-2222-222222222222",
        });
        throw new Error("expected RpcException");
      } catch (e) {
        expect(e).toBeInstanceOf(RpcException);
        const err = (e as RpcException).getError() as { code: number };
        expect(err.code).toBe(status.NOT_FOUND);
      }
    });
  });
});

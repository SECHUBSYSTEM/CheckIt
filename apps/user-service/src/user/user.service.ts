import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { Prisma } from "@packages/prisma-user";
import type {
  CreateUserRequest,
  CreateUserResponse,
  GetUserByIdRequest,
  GetUserByIdResponse,
  User as ProtoUser,
} from "@packages/proto";
import { ServiceError, status } from "@grpc/grpc-js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { WalletClientService } from "../wallet-client/wallet-client.service";
import { CreateUserDto } from "./dto/create-user.dto";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletClient: WalletClientService,
  ) {}

  private toProtoUser(row: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
  }): ProtoUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAtUnixMs: row.createdAt.getTime(),
    };
  }

  async createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
    const dto = plainToInstance(CreateUserDto, data);
    const errors = await validate(dto);
    if (errors.length) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: errors.map((e) => Object.values(e.constraints ?? {}).join(", ")).join("; "),
      });
    }

    let user;
    try {
      user = await this.prisma.user.create({
        data: { email: dto.email, name: dto.name },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: "Email already registered",
        });
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.error(
          `Prisma error creating user: ${e.code}`,
          e.message,
        );
        throw new RpcException({
          code: status.INTERNAL,
          message: "Could not create user",
        });
      }
      this.logger.error(
        "Unexpected error creating user",
        e instanceof Error ? e.stack : String(e),
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: "Could not create user",
      });
    }

    try {
      await this.walletClient.createWallet({
        userId: user.id,
        idempotencyKey: randomUUID(),
      });
    } catch (e: unknown) {
      this.logger.error(
        `Wallet create failed for user ${user.id}; rolling back user`,
        e instanceof Error ? e.stack : String(e),
      );
      await this.prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      const err = e as ServiceError;
      throw new RpcException({
        code: err.code ?? status.UNAVAILABLE,
        message: err.message ?? "Wallet service unavailable",
      });
    }

    return { user: this.toProtoUser(user) };
  }

  async getUserById(data: GetUserByIdRequest): Promise<GetUserByIdResponse> {
    if (!data.userId?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: "userId is required",
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: "User not found",
      });
    }
    return { user: this.toProtoUser(user) };
  }
}

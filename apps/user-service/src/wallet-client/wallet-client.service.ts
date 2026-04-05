import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  WalletServiceClient,
} from "@packages/proto";

@Injectable()
export class WalletClientService implements OnModuleInit {
  private wallet!: WalletServiceClient;

  constructor(@Inject("WALLET_GRPC") private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.wallet = this.client.getService<WalletServiceClient>("WalletService");
  }

  createWallet(request: CreateWalletRequest): Promise<CreateWalletResponse> {
    const deadlineMs = Number(process.env.WALLET_GRPC_DEADLINE_MS ?? "5000");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(new Error("Wallet gRPC deadline exceeded"), {
            code: status.DEADLINE_EXCEEDED,
          }),
        );
      }, deadlineMs);

      this.wallet.createWallet(
        request,
        (err: unknown, response: CreateWalletResponse | undefined) => {
          clearTimeout(timer);
          if (err) {
            reject(err);
            return;
          }
          if (!response) {
            reject(new Error("Empty wallet response"));
            return;
          }
          resolve(response);
        },
      );
    });
  }
}

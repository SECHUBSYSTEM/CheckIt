import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  CreditWalletRequest,
  CreditWalletResponse,
  DebitWalletRequest,
  DebitWalletResponse,
  GetWalletRequest,
  GetWalletResponse,
} from "@packages/proto";
import { WalletService } from "./wallet.service";

@Controller()
export class WalletGrpc {
  constructor(private readonly wallets: WalletService) {}

  @GrpcMethod("WalletService", "CreateWallet")
  createWallet(data: CreateWalletRequest): Promise<CreateWalletResponse> {
    return this.wallets.createWallet(data);
  }

  @GrpcMethod("WalletService", "GetWallet")
  getWallet(data: GetWalletRequest): Promise<GetWalletResponse> {
    return this.wallets.getWallet(data);
  }

  @GrpcMethod("WalletService", "CreditWallet")
  creditWallet(data: CreditWalletRequest): Promise<CreditWalletResponse> {
    return this.wallets.creditWallet(data);
  }

  @GrpcMethod("WalletService", "DebitWallet")
  debitWallet(data: DebitWalletRequest): Promise<DebitWalletResponse> {
    return this.wallets.debitWallet(data);
  }
}

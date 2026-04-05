import { Module } from "@nestjs/common";
import { UserClientModule } from "../user-client/user-client.module";
import { WalletGrpc } from "./wallet.grpc";
import { WalletService } from "./wallet.service";

@Module({
  imports: [UserClientModule],
  controllers: [WalletGrpc],
  providers: [WalletService],
})
export class WalletModule {}

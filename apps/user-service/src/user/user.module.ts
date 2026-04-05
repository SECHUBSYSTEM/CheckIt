import { Module } from "@nestjs/common";
import { WalletClientModule } from "../wallet-client/wallet-client.module";
import { UserGrpc } from "./user.grpc";
import { UserService } from "./user.service";

@Module({
  imports: [WalletClientModule],
  controllers: [UserGrpc],
  providers: [UserService],
})
export class UserModule {}

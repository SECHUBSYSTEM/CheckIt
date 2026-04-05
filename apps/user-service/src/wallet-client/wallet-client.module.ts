import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { protoBaseDir } from "../monorepo-root";
import { WalletClientService } from "./wallet-client.service";

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: "WALLET_GRPC",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: "wallet.v1",
            protoPath: join(protoBaseDir(), "wallet/v1/wallet.proto"),
            url: config.getOrThrow<string>("WALLET_SERVICE_GRPC_URL"),
          },
        }),
      },
    ]),
  ],
  providers: [WalletClientService],
  exports: [WalletClientService],
})
export class WalletClientModule {}

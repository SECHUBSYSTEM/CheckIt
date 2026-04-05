import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { protoBaseDir } from "../monorepo-root";
import { UserClientService } from "./user-client.service";

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: "USER_GRPC",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: "user.v1",
            protoPath: join(protoBaseDir(), "user/v1/user.proto"),
            url: config.getOrThrow<string>("USER_SERVICE_GRPC_URL"),
          },
        }),
      },
    ]),
  ],
  providers: [UserClientService],
  exports: [UserClientService],
})
export class UserClientModule {}

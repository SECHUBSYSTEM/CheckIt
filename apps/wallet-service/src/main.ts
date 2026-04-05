import "reflect-metadata";
import { join } from "node:path";
import { Logger } from "nestjs-pino";
import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { AppModule } from "./app.module";
import { protoBaseDir } from "./monorepo-root";

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: "wallet.v1",
        protoPath: join(protoBaseDir(), "wallet/v1/wallet.proto"),
        url: `0.0.0.0:${process.env.WALLET_GRPC_PORT ?? "50052"}`,
      },
    },
  );
  app.useLogger(app.get(Logger));
  await app.listen();
  app.get(Logger).log(
    `Wallet gRPC listening on 0.0.0.0:${process.env.WALLET_GRPC_PORT ?? "50052"}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

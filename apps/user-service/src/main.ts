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
        package: "user.v1",
        protoPath: join(protoBaseDir(), "user/v1/user.proto"),
        url: `0.0.0.0:${process.env.USER_GRPC_PORT ?? "50051"}`,
      },
    },
  );
  app.useLogger(app.get(Logger));
  await app.listen();
  app.get(Logger).log(
    `User gRPC listening on 0.0.0.0:${process.env.USER_GRPC_PORT ?? "50051"}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

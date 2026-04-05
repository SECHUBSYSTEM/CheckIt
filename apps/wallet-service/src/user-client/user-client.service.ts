import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ClientGrpc } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import type {
  GetUserByIdRequest,
  GetUserByIdResponse,
  UserServiceClient,
} from "@packages/proto";

@Injectable()
export class UserClientService implements OnModuleInit {
  private user!: UserServiceClient;

  constructor(@Inject("USER_GRPC") private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.user = this.client.getService<UserServiceClient>("UserService");
  }

  getUserById(request: GetUserByIdRequest): Promise<GetUserByIdResponse> {
    const deadlineMs = Number(process.env.USER_GRPC_DEADLINE_MS ?? "5000");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(new Error("User gRPC deadline exceeded"), {
            code: status.DEADLINE_EXCEEDED,
          }),
        );
      }, deadlineMs);

      this.user.getUserById(
        request,
        (err: unknown, response: GetUserByIdResponse | undefined) => {
          clearTimeout(timer);
          if (err) {
            reject(err);
            return;
          }
          if (!response) {
            reject(new Error("Empty user response"));
            return;
          }
          resolve(response);
        },
      );
    });
  }
}

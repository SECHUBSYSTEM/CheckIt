import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import type {
  CreateUserRequest,
  CreateUserResponse,
  GetUserByIdRequest,
  GetUserByIdResponse,
} from "@packages/proto";
import { UserService } from "./user.service";

@Controller()
export class UserGrpc {
  constructor(private readonly users: UserService) {}

  @GrpcMethod("UserService", "CreateUser")
  createUser(data: CreateUserRequest): Promise<CreateUserResponse> {
    return this.users.createUser(data);
  }

  @GrpcMethod("UserService", "GetUserById")
  getUserById(data: GetUserByIdRequest): Promise<GetUserByIdResponse> {
    return this.users.getUserById(data);
  }
}

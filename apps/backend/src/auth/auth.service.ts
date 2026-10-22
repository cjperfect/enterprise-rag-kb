import { BadRequestException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { Exceptions, BusinessException } from "../common/exceptions/business.exception";
import { ErrorCode } from "@enterprise-rag-kb/shared";
import * as bcrypt from "bcryptjs";
import type { RegisterDto, LoginDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private validateCredentials(dto: LoginDto) {
    if (
      !dto ||
      typeof dto.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email) ||
      typeof dto.password !== "string" ||
      dto.password.length < 8 ||
      dto.password.length > 128
    )
      throw new BadRequestException("请输入有效邮箱和 8~128 位密码");
  }

  /** 注册 */
  async register(dto: RegisterDto) {
    this.validateCredentials(dto);
    if (typeof dto.name !== "string" || !dto.name.trim()) throw new BadRequestException("请输入用户名");
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BusinessException(ErrorCode.CONFLICT, "邮箱已注册");
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
      },
    });

    return this.signToken(user.id, user.email);
  }

  /** 登录 */
  async login(dto: LoginDto) {
    this.validateCredentials(dto);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw Exceptions.unauthorized("邮箱或密码错误");
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw Exceptions.unauthorized("邮箱或密码错误");
    }

    return this.signToken(user.id, user.email);
  }

  /** 根据 userId 查询用户（供 JWT strategy 使用） */
  async validateUser(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw Exceptions.unauthorized("用户不存在");
    }
    return user;
  }

  /** 签发 JWT */
  private signToken(userId: number, email: string) {
    const payload = { sub: userId, email };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: userId, email },
    };
  }
}

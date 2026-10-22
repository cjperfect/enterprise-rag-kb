import { Controller, Post, Get, Body, Res, SetMetadata } from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { AUTH_COOKIE, COOKIE_OPTIONS } from "./jwt.constants";
import type { RegisterDto, LoginDto } from "./dto/auth.dto";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @SetMetadata("public", true)
  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    res.cookie(AUTH_COOKIE, result.access_token, COOKIE_OPTIONS);
    return { user: result.user };
  }

  @SetMetadata("public", true)
  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    res.cookie(AUTH_COOKIE, result.access_token, COOKIE_OPTIONS);
    return { user: result.user };
  }

  @Get("me")
  me(@CurrentUser() user: { id: number; email: string }) {
    return user;
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, COOKIE_OPTIONS);
    return { success: true };
  }
}

import { AUTH_COOKIE, JWT_SECRET } from "./jwt.constants";
import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService } from "./auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: { headers?: { cookie?: string } }) => {
          const cookie = req.headers?.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith(`${AUTH_COOKIE}=`));
          return cookie?.slice(AUTH_COOKIE.length + 1) ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  /** JWT 验证通过后，将 payload 转为 User 对象注入到 req.user */
  async validate(payload: { sub: number; email: string }) {
    return this.authService.validateUser(payload.sub);
  }
}

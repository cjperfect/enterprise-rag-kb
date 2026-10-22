import { Controller, Get, SetMetadata } from "@nestjs/common";
import { AppService } from "./app.service";

@SetMetadata("public", true)
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}

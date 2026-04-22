import {
  Body,
  Controller,
  Post
} from '@nestjs/common';
import { PublicVerifyService } from './public-verify.service.js';

@Controller('api/public')
export class PublicVerifyController {
  constructor(private readonly publicVerifyService: PublicVerifyService) {}

  @Post('verify-receipt')
  async verifyReceipt(@Body() body: unknown) {
    return this.publicVerifyService.verifyReceipt(body);
  }
}

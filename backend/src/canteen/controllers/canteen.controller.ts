import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WalletService } from '../../finance/services/wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CanteenPurchaseRequestDto } from '../dto/purchase.dto';

@ApiTags('Canteen - POS & Menu')
@Controller({ path: 'canteen', version: '1' })
export class CanteenController {
  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /api/v1/canteen/purchase
   * Canteen POS terminal NFC tap purchase endpoint.
   * Atomically debits student wallet, enforces dietary restrictions & daily caps,
   * and sends a real-time notification to the parent.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post('purchase')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Process student NFC canteen purchase at POS',
    description:
      'Checks daily limit, validates parent dietary restrictions, deducts wallet balance, creates double-entry ledger records, and notifies parents.',
  })
  @ApiResponse({
    status: 200,
    description: 'Purchase processed and parent notified',
  })
  @ApiResponse({
    status: 400,
    description: 'Insufficient balance or daily limit exceeded',
  })
  @ApiResponse({
    status: 403,
    description: 'Parent restricted one or more items in the cart',
  })
  @ApiResponse({
    status: 404,
    description: 'Student or NFC card not found',
  })
  async processPurchase(
    @Body() dto: CanteenPurchaseRequestDto,
    @Request() req: any,
  ) {
    const operatorId = req.user?.sub;
    return this.walletService.processCanteenTransaction(
      dto.studentNfcUid,
      dto.items,
      operatorId,
    );
  }

  /**
   * GET /api/v1/canteen/menu
   * Retrieves all categories and available items for the tenant canteen.
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Get('menu')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve full canteen menu with allergens and categories' })
  @ApiResponse({ status: 200, description: 'List of canteen categories and items' })
  async getMenu(@Request() req: any) {
    const tenantId = req.user?.tenantId;
    const whereClause = tenantId ? { tenantId } : {};

    return this.prisma.canteenCategory.findMany({
      where: whereClause,
      include: {
        items: {
          where: { isAvailable: true },
        },
      },
      orderBy: { nameEn: 'asc' },
    });
  }
}

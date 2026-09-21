import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { UpdateDietaryRestrictionsDto } from '../dto/dietary.dto';

@ApiTags('Canteen - Dietary Restrictions')
@ApiBearerAuth('access-token')
@Controller({ path: ['canteen/restrictions', 'restrictions'], version: '1' })
export class DietaryController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * POST /api/v1/canteen/restrictions or POST /api/v1/restrictions
   * Allows parents to block specific food categories, individual products,
   * or allergen keywords (e.g. "Soda", "Peanuts") from their child's NFC card.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure dietary restrictions and blocked items for a student',
    description:
      'Parents can enforce daily spending caps and prohibit categories or allergen keywords. Any POS attempt to purchase restricted items will be rejected with 403 Forbidden.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dietary restrictions updated successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'User lacks parental authority for this student',
  })
  async updateRestrictions(
    @Body() dto: UpdateDietaryRestrictionsDto,
    @Request() req: any,
  ) {
    const requestingUserId = req.user?.sub;
    const userRoles = req.user?.roles ?? [];

    return this.walletService.updateDietaryRestrictions(
      dto.studentId,
      {
        dailyLimit: dto.dailyLimit,
        blockedCategoryIds: dto.blockedCategoryIds,
        blockedItemIds: dto.blockedItemIds,
        blockedKeywords: dto.blockedKeywords,
      },
      requestingUserId,
      userRoles,
    );
  }

  /**
   * GET /api/v1/canteen/restrictions/:studentId
   * Retrieves active dietary restrictions and daily cap for a student.
   */
  @UseGuards(JwtAuthGuard)
  @Get(':studentId')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve student dietary restrictions' })
  @ApiResponse({ status: 200, description: 'Returns active restrictions' })
  async getRestrictions(@Param('studentId') studentId: string) {
    const wallet = await this.walletService.getWallet(studentId);
    return {
      studentId,
      dailyLimit: Number(wallet.dailyLimit),
      blockedCategoryIds: wallet.blockedCategoryIds,
      blockedItemIds: (wallet as any).blockedItemIds || [],
      blockedKeywords: (wallet as any).blockedKeywords || [],
    };
  }
}

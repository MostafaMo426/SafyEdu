import {
  Controller,
  Post,
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
import { BoardingService } from '../services/boarding.service';
import { BoardDto } from '../dto/board.dto';

@ApiTags('Logistics - Boarding')
@ApiBearerAuth('access-token')
@Controller({ path: ['logistics/board', 'board'], version: '1' })
export class BoardingController {
  constructor(private readonly boardingService: BoardingService) {}

  /**
   * POST /api/v1/logistics/board or POST /api/v1/board
   * Scans a physical NFC student card, verifies assignment, persists BoardingLog,
   * and fires real-time WebSocket / Redis Pub/Sub notifications.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Process NFC student card tap (Boarding / Alighting)',
    description:
      'Scanned by the matron mobile device. Resolves the student, checks bus route assignment, logs the event to PostgreSQL, and notifies parents in real-time.',
  })
  @ApiResponse({
    status: 200,
    description: 'NFC tap successfully recorded and parent notified',
  })
  @ApiResponse({
    status: 400,
    description: 'Student not assigned to this bus or inactive',
  })
  @ApiResponse({
    status: 404,
    description: 'NFC Card UID not found',
  })
  async handleBoardingTap(@Body() dto: BoardDto, @Request() req: any) {
    const scannedByUserId = req.user?.sub ?? '00000000-0000-0000-0000-000000000000';
    return this.boardingService.processTap(dto, scannedByUserId);
  }
}

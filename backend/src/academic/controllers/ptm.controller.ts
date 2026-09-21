import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PtmService } from '../services/ptm.service';
import {
  BookPtmSlotDto,
  CreatePtmCycleDto,
  CreatePtmSlotDto,
} from '../dto/ptm.dto';

@ApiTags('Academic - Parent-Teacher Conferences (PTM)')
@Controller({ path: 'ptm', version: '1' })
export class PtmController {
  constructor(private readonly ptmService: PtmService) {}

  /**
   * POST /api/v1/ptm/book
   * Concurrency-safe Parent-Teacher Meeting (PTM) slot booker:
   * - Validates parent-student relationship.
   * - Validates teacher actually teaches this student in their enrolled classroom.
   * - Locks slot atomically to prevent double booking (returns 409 Conflict if taken).
   */
  @Post('book')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Book a 10-minute Parent-Teacher Conference slot',
    description:
      'Locks the slot exclusively via an atomic transaction. Validates parentage and teacher-student classroom assignment.',
  })
  @ApiResponse({ status: 200, description: 'Slot booked successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request or cycle closed' })
  @ApiResponse({ status: 403, description: 'Parentage or teacher assignment check failed' })
  @ApiResponse({ status: 404, description: 'Slot or student enrollment not found' })
  @ApiResponse({ status: 409, description: 'Slot already booked or unavailable' })
  async bookSlot(@Body() dto: BookPtmSlotDto, @Request() req: any) {
    const requestingUserId = req.user?.sub;
    return this.ptmService.bookSlot(dto, requestingUserId);
  }

  /**
   * GET /api/v1/ptm/slots/:cycleId
   * Retrieves all slots for a conference cycle.
   */
  @Get('slots/:cycleId')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all conference slots for a cycle' })
  @ApiParam({ name: 'cycleId', description: 'PTM Cycle ID' })
  @ApiQuery({ name: 'teacherId', required: false, description: 'Filter by Teacher User ID' })
  @ApiResponse({ status: 200, description: 'Slots retrieved successfully' })
  async getCycleSlots(
    @Param('cycleId') cycleId: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.ptmService.getCycleSlots(cycleId, teacherId);
  }

  /**
   * GET /api/v1/ptm/cycles
   * Retrieves active conference cycles.
   */
  @Get('cycles')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get active PTM conference cycles' })
  @ApiQuery({ name: 'termId', required: false, description: 'Filter by Term ID' })
  @ApiResponse({ status: 200, description: 'Active cycles retrieved' })
  async getActiveCycles(@Query('termId') termId?: string) {
    return this.ptmService.getActiveCycles(termId);
  }

  /**
   * POST /api/v1/ptm/cycles
   * Creates a new PTM conference cycle.
   */
  @Post('cycles')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a PTM conference cycle' })
  @ApiResponse({ status: 201, description: 'Cycle created successfully' })
  async createCycle(@Body() dto: CreatePtmCycleDto) {
    return this.ptmService.createCycle(dto);
  }

  /**
   * POST /api/v1/ptm/slots
   * Creates a single conference slot for a teacher.
   */
  @Post('slots')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a single PTM slot' })
  @ApiResponse({ status: 201, description: 'Slot created successfully' })
  async createSlot(@Body() dto: CreatePtmSlotDto) {
    return this.ptmService.createSlot(dto);
  }
}

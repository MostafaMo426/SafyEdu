import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FleetBusLocationDto {
  @ApiProperty({ example: 30.04442 })
  latitude: number;

  @ApiProperty({ example: 31.23571 })
  longitude: number;

  @ApiPropertyOptional({ example: 45.2 })
  speed?: number;

  @ApiPropertyOptional({ example: 180 })
  heading?: number;

  @ApiProperty({ example: '2026-09-21T15:10:00.000Z' })
  lastUpdated: string;
}

export class ActiveFleetItemDto {
  @ApiProperty({ example: 'd3b07384-d113-40a2-97b7-5f6e61234567' })
  busId: string;

  @ApiProperty({ example: 'd3b07384-d113-40a2-97b7-5f6e61234567' })
  routeId: string;

  @ApiProperty({ example: 'New Cairo Line 4' })
  routeName: string;

  @ApiProperty({ example: 'ط ر ق 1 2 3' })
  vehiclePlate: string;

  @ApiProperty({ example: 40 })
  capacity: number;

  @ApiProperty({ example: 28 })
  passengerCount: number;

  @ApiProperty({ example: 'IN_PROGRESS' })
  status: string;

  @ApiPropertyOptional({ example: 'Mahmoud El-Sayed' })
  driverName?: string;

  @ApiPropertyOptional({ example: '+201012345678' })
  driverPhone?: string;

  @ApiPropertyOptional({ type: FleetBusLocationDto })
  location?: FleetBusLocationDto;

  @ApiProperty({ example: true })
  isOnline: boolean;
}

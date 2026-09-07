import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { BroadcastsService } from './broadcasts.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class CreateBroadcastDto {
  @IsUUID() propertyId!: string;
  /** The owner thinks in "last day / week / month", not in dates. */
  @IsIn([1, 7, 30, 90]) audienceWindowDays!: number;
  @IsOptional() @IsBoolean() matchLeadPreferences?: boolean;
  @IsOptional() @IsString() message?: string;
}

@ApiTags('broadcasts')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Post()
  @ApiOperation({
    summary: 'Queue a property to customers who searched inside the chosen window',
    description:
      'Recipients are deduplicated against everyone who already received this ' +
      'property, capped per customer per day, and paced to protect the number.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.plan({
      officeId: user.officeId!,
      propertyId: dto.propertyId,
      createdById: user.id,
      audienceWindowDays: dto.audienceWindowDays,
      matchLeadPreferences: dto.matchLeadPreferences,
      message: dto.message,
    });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.broadcasts.list(user.officeId!);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.broadcasts.getWithProperty(id);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.broadcasts.stats(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.broadcasts.cancel(id);
  }
}

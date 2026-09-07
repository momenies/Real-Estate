import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { LeadsService } from './leads.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class AudienceQueryDto {
  @IsOptional() @IsInt() @Min(1) windowDays?: number;
}

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('take') take = '50',
    @Query('skip') skip = '0',
  ) {
    return this.leads.list(user.officeId!, Number.parseInt(take, 10), Number.parseInt(skip, 10));
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.countByOffice(user.officeId!);
  }

  @Post('audience/preview')
  @ApiOperation({ summary: 'Who would receive a broadcast for a given time window' })
  async preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: AudienceQueryDto) {
    const audience = await this.leads.findAudience(user.officeId!, dto.windowDays ?? 30);
    return { windowDays: dto.windowDays ?? 30, count: audience.length };
  }

  @Post(':id/opt-out')
  optOut(@Param('id') id: string) {
    return this.leads.optOut(id);
  }
}

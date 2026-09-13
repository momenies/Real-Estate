import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OfficeStatus, PlanCode, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AdminService } from './admin.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class ActivateSubscriptionDto {
  @IsEnum(PlanCode) plan!: PlanCode;
  @IsInt() @Min(1) months!: number;
  @IsInt() @Min(0) priceSar!: number;
}

class SetOfficeStatusDto {
  @IsEnum(OfficeStatus) status!: OfficeStatus;
}

/**
 * The guardrail ranges are bounded here on purpose: these are the values that
 * decide how hard an office hits its customers, so the API refuses a setting
 * that would put the office's WhatsApp number at risk even if a UI asked for it.
 */
class UpdateOfficeSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(10) dailyCapPerLead?: number;
  @IsOptional() @IsInt() @Min(0) @Max(72) minHoursBetweenMessages?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietHoursStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(24) quietHoursEnd?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) broadcastRatePerMinute?: number;
  @IsOptional() @IsBoolean() autoSendLatestToNewLead?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10) latestCount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(240) draftWindowMinutes?: number;
  @IsOptional() @IsString() defaultCity?: string;
}

class SearchDto {
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsString() officeId?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsInt() minPrice?: number;
  @IsOptional() @IsInt() maxPrice?: number;
  @IsOptional() @IsInt() take?: number;
  @IsOptional() @IsInt() skip?: number;
}

/** Every route here is super-admin only - this is the cross-office surface. */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Network-wide counts across every office' })
  overview() {
    return this.admin.networkOverview();
  }

  @Get('offices')
  offices() {
    return this.admin.officesTable();
  }

  @Post('properties/search')
  @ApiOperation({ summary: 'Search inventory across all offices' })
  search(@Body() dto: SearchDto) {
    return this.admin.searchProperties(dto);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Aggregated supply and demand across the network' })
  insights() {
    return this.admin.demandInsights();
  }

  @Get('subscriptions/expiring')
  expiring(@Query('days') days = '14') {
    return this.admin.expiringSubscriptions(Number.parseInt(days, 10));
  }

  @Post('offices/:id/subscription/activate')
  @ApiOperation({ summary: 'Convert a trial into a paid subscription' })
  activate(@Param('id') officeId: string, @Body() dto: ActivateSubscriptionDto) {
    return this.subscriptions.activate(officeId, dto.plan, dto.months, dto.priceSar);
  }

  @Post('offices/:id/subscription/cancel')
  cancel(@Param('id') officeId: string, @Body('reason') reason?: string) {
    return this.subscriptions.cancel(officeId, reason);
  }

  @Patch('offices/:id/status')
  @ApiOperation({
    summary: 'Suspend or reactivate an office',
    description:
      'A suspended office stops being served entirely: inbound messages are ' +
      'dropped and any queued broadcast stops dispatching.',
  })
  setStatus(@Param('id') officeId: string, @Body() dto: SetOfficeStatusDto) {
    return this.admin.setOfficeStatus(officeId, dto.status);
  }

  @Get('offices/:id/settings')
  @ApiOperation({ summary: "Read an office's anti-spam guardrails" })
  settings(@Param('id') officeId: string) {
    return this.admin.officeSettings(officeId);
  }

  @Patch('offices/:id/settings')
  @ApiOperation({ summary: "Tune an office's anti-spam guardrails" })
  updateSettings(@Param('id') officeId: string, @Body() dto: UpdateOfficeSettingsDto) {
    return this.admin.updateOfficeSettings(officeId, dto);
  }

  @Get('audit')
  @ApiOperation({ summary: 'The control trail: who changed what, newest first' })
  audit(@Query('take') take = '50') {
    return this.admin.auditTrail(Math.min(Number.parseInt(take, 10) || 50, 200));
  }
}

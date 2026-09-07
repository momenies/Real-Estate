import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanCode, UserRole } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AdminService } from './admin.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class ActivateSubscriptionDto {
  @IsEnum(PlanCode) plan!: PlanCode;
  @IsInt() @Min(1) months!: number;
  @IsInt() @Min(0) priceSar!: number;
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
}

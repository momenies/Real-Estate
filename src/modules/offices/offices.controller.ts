import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min, IsBoolean } from 'class-validator';
import { OfficesService } from './offices.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CurrentUser, AuthenticatedUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class CreateOfficeDto {
  @IsString() name!: string;
  @IsString() ownerName!: string;
  @IsString() ownerPhone!: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() whatsappPhoneNumberId?: string;
  @IsOptional() @IsString() whatsappDisplayNumber?: string;
  @IsOptional() @IsString() wabaId?: string;
}

class UpdateSettingsDto {
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

@ApiTags('offices')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('offices')
export class OfficesController {
  constructor(
    private readonly offices: OfficesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Onboard an office and start its 3-month free trial' })
  create(@Body() dto: CreateOfficeDto) {
    return this.offices.createOffice(dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in office, its settings and subscription' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const officeId = user.officeId!;
    const [office, settings, access] = await Promise.all([
      this.offices.getOrThrow(officeId),
      this.offices.getSettings(officeId),
      this.subscriptions.checkAccess(officeId),
    ]);
    return { office, settings, subscription: access };
  }

  @Patch('me/settings')
  @ApiOperation({ summary: 'Tune the anti-spam guardrails for this office' })
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.offices.updateSettings(user.officeId!, dto);
  }

  @Get(':id/settings')
  @Roles(UserRole.SUPER_ADMIN)
  settings(@Param('id') id: string) {
    return this.offices.getSettings(id);
  }
}

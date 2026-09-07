import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUrl, IsUUID } from 'class-validator';
import { Response } from 'express';
import { TiktokService } from './tiktok.service';
import { HarajService } from './haraj.service';
import { renderHarajPage } from './haraj-page.template';
import { CurrentUser, AuthenticatedUser, Public } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

class PublishDto {
  @IsUUID() propertyId!: string;
}

class RecordPostedDto {
  @IsString() publicationId!: string;
  @IsUrl() url!: string;
}

@ApiTags('external-channels')
@Controller()
export class ExternalController {
  constructor(
    private readonly tiktok: TiktokService,
    private readonly haraj: HarajService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Get('integrations/tiktok/authorize')
  @ApiOperation({ summary: 'Start the one-time TikTok OAuth consent for this office' })
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return this.tiktok.buildAuthorizationUrl(user.officeId!);
  }

  @Public()
  @Get('integrations/tiktok/callback')
  @ApiExcludeEndpoint()
  async callback(@Query('code') code: string, @Query('state') state: string) {
    const account = await this.tiktok.handleCallback(code, state);
    return { connected: true, platform: account.platform, account: account.displayName };
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Post('integrations/tiktok/publish')
  @ApiOperation({ summary: 'Publish a property video through the official TikTok API' })
  publishToTiktok(@CurrentUser() user: AuthenticatedUser, @Body() dto: PublishDto) {
    return this.tiktok.publishProperty(user.officeId!, dto.propertyId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Post('integrations/haraj/prepare')
  @ApiOperation({
    summary: 'Build a ready-to-paste Haraj listing',
    description:
      'Returns a share link with the title, body and ordered images. Posting stays ' +
      'manual on purpose - automating Haraj is what gets accounts banned.',
  })
  prepareHaraj(@CurrentUser() user: AuthenticatedUser, @Body() dto: PublishDto) {
    return this.haraj.preparePackage(user.officeId!, dto.propertyId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Post('integrations/haraj/posted')
  recordPosted(@Body() dto: RecordPostedDto) {
    return this.haraj.recordPosted(dto.publicationId, dto.url);
  }

  /** The copy-paste helper the owner opens on their phone. */
  @Public()
  @Get('share/haraj/:token')
  @ApiExcludeEndpoint()
  async harajPage(@Param('token') token: string, @Res() response: Response) {
    const publication = await this.haraj.getByShareToken(token);
    response.type('html').send(renderHarajPage(publication));
  }
}

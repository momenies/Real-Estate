import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('properties')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @ApiOperation({ summary: 'Published inventory for the signed-in office' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('take') take = '20',
    @Query('skip') skip = '0',
  ) {
    return this.properties.findPublished(
      user.officeId!,
      Number.parseInt(take, 10),
      Number.parseInt(skip, 10),
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.properties.getOrThrow(id);
  }

  @Get(':id/media')
  media(@Param('id') id: string) {
    return this.properties.getMedia(id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.properties.archive(id);
  }
}

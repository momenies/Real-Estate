import { Module } from '@nestjs/common';
import { TiktokService } from './tiktok.service';
import { HarajService } from './haraj.service';
import { ExternalController } from './external.controller';
import { PropertiesModule } from '../properties/properties.module';
import { OfficesModule } from '../offices/offices.module';

@Module({
  imports: [PropertiesModule, OfficesModule],
  controllers: [ExternalController],
  providers: [TiktokService, HarajService],
  exports: [TiktokService, HarajService],
})
export class ExternalModule {}

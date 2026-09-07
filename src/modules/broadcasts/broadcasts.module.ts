import { Module, forwardRef } from '@nestjs/common';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastsController } from './broadcasts.controller';
import { AntiSpamService } from './anti-spam.service';
import { BroadcastDispatcherService } from './broadcast-dispatcher.service';
import { LeadsModule } from '../leads/leads.module';
import { OfficesModule } from '../offices/offices.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [LeadsModule, forwardRef(() => OfficesModule), forwardRef(() => WhatsappModule)],
  controllers: [BroadcastsController],
  providers: [BroadcastsService, AntiSpamService, BroadcastDispatcherService],
  exports: [BroadcastsService, AntiSpamService],
})
export class BroadcastsModule {}

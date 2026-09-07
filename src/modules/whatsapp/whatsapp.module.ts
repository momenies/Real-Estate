import { Module, forwardRef } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappApiService } from './whatsapp-api.service';
import { ConversationService } from './conversation.service';
import { OwnerFlowService } from './flows/owner-flow.service';
import { LeadFlowService } from './flows/lead-flow.service';
import { DraftFinalizerService } from './flows/draft-finalizer.service';
import { OfficesModule } from '../offices/offices.module';
import { PropertiesModule } from '../properties/properties.module';
import { LeadsModule } from '../leads/leads.module';
import { MediaModule } from '../media/media.module';
import { BroadcastsModule } from '../broadcasts/broadcasts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    forwardRef(() => OfficesModule),
    PropertiesModule,
    LeadsModule,
    MediaModule,
    forwardRef(() => BroadcastsModule),
    forwardRef(() => SubscriptionsModule),
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappApiService,
    ConversationService,
    OwnerFlowService,
    LeadFlowService,
    DraftFinalizerService,
  ],
  exports: [WhatsappService, WhatsappApiService, ConversationService],
})
export class WhatsappModule {}

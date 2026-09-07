import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsScheduler } from './subscriptions.scheduler';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { OfficesModule } from '../offices/offices.module';

@Module({
  imports: [forwardRef(() => WhatsappModule), forwardRef(() => OfficesModule)],
  providers: [SubscriptionsService, SubscriptionsScheduler],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

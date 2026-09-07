import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { WhatsappApiService } from '../whatsapp/whatsapp-api.service';

@Module({
  providers: [MediaService, WhatsappApiService],
  exports: [MediaService, WhatsappApiService],
})
export class MediaModule {}

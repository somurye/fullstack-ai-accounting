import { Module } from '@nestjs/common';
import { AiSuggestionsController } from './ai-suggestions.controller';
import { AiSuggestionsService } from './ai-suggestions.service';

@Module({
  controllers: [AiSuggestionsController],
  providers: [AiSuggestionsService],
  exports: [AiSuggestionsService],
})
export class AiSuggestionsModule {}

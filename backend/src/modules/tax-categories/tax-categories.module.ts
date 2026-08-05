import { Module } from '@nestjs/common';
import { TaxCategoriesController } from './tax-categories.controller';
import { TaxCategoriesService } from './tax-categories.service';

@Module({
  controllers: [TaxCategoriesController],
  providers: [TaxCategoriesService],
})
export class TaxCategoriesModule {}

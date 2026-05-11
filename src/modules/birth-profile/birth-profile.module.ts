import { Module } from '@nestjs/common';
import { BirthProfileController } from './birth-profile.controller';
import { BirthProfileService } from './birth-profile.service';
import { AstrologyModule } from '../astrology/astrology.module';

@Module({
  imports: [AstrologyModule],
  controllers: [BirthProfileController],
  providers: [BirthProfileService],
  exports: [BirthProfileService],
})
export class BirthProfileModule {}

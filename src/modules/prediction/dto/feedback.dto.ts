import { IsIn, IsOptional, IsString } from 'class-validator';

export class SubmitPredictionFeedbackDto {
  @IsIn(['good', 'bad'])
  feedback!: 'good' | 'bad';

  @IsOptional()
  @IsString()
  actualOutcome?: string;

  @IsOptional()
  @IsString()
  contextType?: string;

  @IsOptional()
  @IsString()
  timeSlot?: string;
}

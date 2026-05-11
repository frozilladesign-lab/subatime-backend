import { Injectable } from '@nestjs/common';

const LAGNA_SIGNS = [
  'Mesha',
  'Vrishabha',
  'Mithuna',
  'Karka',
  'Simha',
  'Kanya',
  'Tula',
  'Vrischika',
  'Dhanu',
  'Makara',
  'Kumbha',
  'Meena',
] as const;

@Injectable()
export class LagnaService {
  calculate(birthDate: Date): string {
    const totalMinutes = birthDate.getUTCHours() * 60 + birthDate.getUTCMinutes();
    const twoHourSlot = Math.floor(totalMinutes / 120) % LAGNA_SIGNS.length;
    return LAGNA_SIGNS[twoHourSlot];
  }
}

import { Injectable } from '@nestjs/common';

const NAKSHATRA_LIST = [
  'Ashwini',
  'Bharani',
  'Krittika',
  'Rohini',
  'Mrigashira',
  'Ardra',
  'Punarvasu',
  'Pushya',
  'Ashlesha',
  'Magha',
  'Purva Phalguni',
  'Uttara Phalguni',
  'Hasta',
  'Chitra',
  'Swati',
  'Vishakha',
  'Anuradha',
  'Jyeshtha',
  'Mula',
  'Purva Ashadha',
  'Uttara Ashadha',
  'Shravana',
  'Dhanishta',
  'Shatabhisha',
  'Purva Bhadrapada',
  'Uttara Bhadrapada',
  'Revati',
] as const;

@Injectable()
export class NakshatraService {
  calculate(birthDate: Date): string {
    const startOfYear = Date.UTC(birthDate.getUTCFullYear(), 0, 1);
    const daysSinceYearStart = Math.floor(
      (birthDate.getTime() - startOfYear) / (1000 * 60 * 60 * 24),
    );
    const index = ((daysSinceYearStart % NAKSHATRA_LIST.length) + NAKSHATRA_LIST.length) % NAKSHATRA_LIST.length;
    return NAKSHATRA_LIST[index];
  }
}

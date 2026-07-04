import { BadRequestException } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { PrismaService } from '../../database/prisma.service';

/** `compare`/`compareAshtakoota` are pure (don't touch `this.prisma`) — no real client needed. */
const unusedPrisma = {} as unknown as PrismaService;

/**
 * Regression baseline for `MatchingService.compare()` — locks in score/breakdown/dosha/
 * recommendations for a fixed set of profile pairs so moving the compatibility math into
 * `@subatime/jyotisha-engine` can be checked against unintentional drift.
 *
 * If this snapshot changes, the matching math changed — verify that was intentional before
 * updating the snapshot.
 */
describe('MatchingService.compare regression baseline', () => {
  const service = new MatchingService(unusedPrisma);

  it('matching pair (same moon sign, same nakshatra letter, manglik mismatch)', () => {
    const result = service.compare({
      profileA: { lagna: 'Mesha', nakshatra: 'Ashwini', moonSign: 'Karka', marsHouse: 1 },
      profileB: { lagna: 'Dhanu', nakshatra: 'Anuradha', moonSign: 'Karka', marsHouse: 3 },
    });
    expect(result).toMatchSnapshot();
  });

  it('mismatched pair (different signs, no manglik mismatch)', () => {
    const result = service.compare({
      profileA: { lagna: 'Vrishabha', nakshatra: 'Bharani', moonSign: 'Simha', marsHouse: 7 },
      profileB: { lagna: 'Mithuna', nakshatra: 'Chitra', moonSign: 'Kumbha', marsHouse: 7 },
    });
    expect(result).toMatchSnapshot();
  });

  it('falls back to zodiacSign-only input', () => {
    const result = service.compare({
      profileA: { zodiacSign: 'Aries' },
      profileB: { zodiacSign: 'Libra' },
    });
    expect(result).toMatchSnapshot();
  });

  it('throws BadRequestException on insufficient profile data', () => {
    expect(() => service.compare({ profileA: {}, profileB: { zodiacSign: 'Leo' } })).toThrow(
      BadRequestException,
    );
  });
});

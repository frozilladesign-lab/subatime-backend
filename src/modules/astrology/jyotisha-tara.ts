/**
 * Tara Bāla (nakṣatra tara): count from birth star to transiting star (1…27),
 * then (count−1) mod 9 + 1 → one of nine tara categories.
 * Aligns with common Sinhala/Indian panchāṅga practice for daily luck from Chandra.
 */
export const TARA_NAMES_EN = [
  'Janma',
  'Sampat',
  'Vipat',
  'Kshema',
  'Pratyak',
  'Sadhana',
  'Naidhana',
  'Mitra',
  'Parama Mitra',
] as const;

/** @param natalNakIdx birth Moon nakṣatra 0…26 @param transitNakIdx transiting Moon nakṣatra 0…26 */
export function taraIndex1to9(natalNakIdx: number, transitNakIdx: number): number {
  const n = ((natalNakIdx % 27) + 27) % 27;
  const t = ((transitNakIdx % 27) + 27) % 27;
  const count = (t - n + 27) % 27;
  const c = count + 1;
  return ((c - 1) % 9) + 1;
}

export function taraNameEn(index1to9: number): string {
  const i = Math.min(9, Math.max(1, index1to9)) - 1;
  return TARA_NAMES_EN[i] ?? 'Janma';
}

/** Score 0…1 for block blending (auspicious tara higher). */
export function taraScoreFromIndex1to9(tara1to9: number): number {
  switch (tara1to9) {
    case 2:
    case 4:
    case 6:
    case 8:
    case 9:
      return 1;
    case 1:
      return 0.48;
    case 3:
    case 5:
      return 0.34;
    case 7:
      return 0.2;
    default:
      return 0.5;
  }
}

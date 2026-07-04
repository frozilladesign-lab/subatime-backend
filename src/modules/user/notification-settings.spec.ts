import {
  defaultNotificationSettings,
  focusAreasFromLegacyIntent,
  personalizationIntentFromFocusAreas,
  resolveNotificationSettings,
  sanitizeNotificationSettings,
} from './notification-settings';

describe('defaultNotificationSettings', () => {
  it('matches the product defaults: important-only, quiet nights, practical+balanced', () => {
    const d = defaultNotificationSettings();
    expect(d.frequency).toBe('important_only');
    expect(d.categories.dailyGuidance).toBe(true);
    expect(d.categories.bestTime).toBe(true);
    expect(d.quietHours).toEqual({ enabled: true, start: '22:00', end: '06:00' });
    expect(d.preferredTimes).toEqual({ morning: '07:00', evening: '18:30' });
    expect(d.tones).toEqual(['practical', 'balanced']);
    expect(d.focusAreas).toEqual([]);
  });
});

describe('focusAreasFromLegacyIntent (migration)', () => {
  it('maps legacy multi-intent to the new focus areas', () => {
    expect(focusAreasFromLegacyIntent('career,love')).toEqual(['career', 'relationship']);
    expect(focusAreasFromLegacyIntent('growth')).toEqual(['education']);
    expect(focusAreasFromLegacyIntent('dreams')).toEqual(['spiritual']);
  });

  it('ignores unknown/empty values and dedupes', () => {
    expect(focusAreasFromLegacyIntent('career, career, banana')).toEqual(['career']);
    expect(focusAreasFromLegacyIntent(null)).toEqual([]);
    expect(focusAreasFromLegacyIntent('')).toEqual([]);
  });
});

describe('resolveNotificationSettings', () => {
  it('seeds focusAreas from legacy intent when no settings are stored (migration path)', () => {
    const { settings, migrated } = resolveNotificationSettings({}, 'love,growth');
    expect(migrated).toBe(true);
    expect(settings.focusAreas).toEqual(['relationship', 'education']);
    expect(settings.migratedFromIntent).toBe(true);
    expect(settings.frequency).toBe('important_only');
  });

  it('returns stored settings untouched by the legacy intent (settings are source of truth)', () => {
    const stored = { ...defaultNotificationSettings(), focusAreas: ['money'], frequency: 'two_per_day' };
    const { settings, migrated } = resolveNotificationSettings(
      { notificationSettings: stored },
      'love',
    );
    expect(migrated).toBe(false);
    expect(settings.focusAreas).toEqual(['money']);
    expect(settings.frequency).toBe('two_per_day');
  });
});

describe('sanitizeNotificationSettings', () => {
  it('drops invalid values back to defaults and clamps tones to 2', () => {
    const s = sanitizeNotificationSettings({
      categories: { dailyGuidance: false, bogus: true, career: 'yes' },
      frequency: 'hourly',
      preferredTimes: { morning: '25:99', evening: '18:30' },
      quietHours: { enabled: 'nope', start: '23:15', end: 'bad' },
      focusAreas: ['career', 'CAREER', 'astral-projection', 'health'],
      tones: ['spiritual', 'detailed', 'positive'],
    });
    expect(s.categories.dailyGuidance).toBe(false);
    expect(s.categories.career).toBe(true); // non-boolean ignored
    expect('bogus' in s.categories).toBe(false);
    expect(s.frequency).toBe('important_only');
    expect(s.preferredTimes).toEqual({ morning: '07:00', evening: '18:30' });
    expect(s.quietHours).toEqual({ enabled: true, start: '23:15', end: '06:00' });
    expect(s.focusAreas).toEqual(['career', 'health']);
    expect(s.tones).toEqual(['spiritual', 'detailed']);
  });

  it('round-trips a valid settings object unchanged', () => {
    const d = { ...defaultNotificationSettings(), focusAreas: ['travel', 'spiritual'] };
    expect(sanitizeNotificationSettings(d)).toEqual(d);
  });
});

describe('personalizationIntentFromFocusAreas (dominantContext derivation)', () => {
  it('maps focus areas onto engine context tokens', () => {
    expect(personalizationIntentFromFocusAreas(['career', 'money'])).toBe('career');
    expect(personalizationIntentFromFocusAreas(['relationship'])).toBe('love');
    expect(personalizationIntentFromFocusAreas(['health', 'spiritual'])).toBe('health,overall');
    expect(personalizationIntentFromFocusAreas(['education', 'business'])).toBe('career');
    expect(personalizationIntentFromFocusAreas([])).toBe('');
  });
});

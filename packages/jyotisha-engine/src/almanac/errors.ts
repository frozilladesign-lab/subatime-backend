/**
 * Thrown when a pañcāṅga/almanac calculation cannot be produced (invalid timezone, invalid
 * calendar date for that timezone, or a sunrise/sunset failure — e.g. polar day/night or an
 * ephemeris error). Plain `Error` subclass so the engine stays framework-agnostic; callers
 * (e.g. the NestJS backend) translate this into their own HTTP error type.
 */
export class AlmanacCalculationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AlmanacCalculationError';
    this.code = code;
  }
}

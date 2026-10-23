export interface RateFixture { id: string; start: string; end: string; dayClass: string; cents: number }
export interface UnitFixture { key: string; name: string; capacity: number; id: string; scheduleId: string; rates: RateFixture[] }
export function planned(): UnitFixture[];
export function seed(connectionString?: string): Promise<void>;

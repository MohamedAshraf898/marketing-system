import type { Campaign, Client, User } from '@prisma/client';

/** Everything the demo-data seeders share. Each group's seeder creates its own rows and queries the DB for the rest. */
export interface SeedCtx {
  admin: User;
  sara: User; // TEAM, assigned to Lumen
  omar: User; // TEAM, assigned to Ufuq (+ campaign L3 of Lumen)
  lumen: Client;
  ufuq: Client;
  lumenUser: User; // CLIENT of Lumen
  ufuqUser: User; // CLIENT of Ufuq
  campaigns: { L1: Campaign; L2: Campaign; L3: Campaign; U1: Campaign; U2: Campaign; U3: Campaign };
  daysAgo: (n: number, hour?: number) => Date; // n days in the past (negative = future) at the given hour
  dayOnly: (n: number) => Date; // date-only (UTC midnight), n days in the past (negative = future)
}

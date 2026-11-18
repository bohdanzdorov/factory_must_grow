import { z } from 'zod';

// Response of GET /api/destinations: the countries orders can be shipped to, sorted.
export const DestinationsSchema = z.array(z.string());
export type Destinations = z.infer<typeof DestinationsSchema>;

import type { Destinations } from '@factorymustgrow/shared';
import { db } from '../config/database.js';

// The destinations orders can use: exactly those with a shipping time from some site.
export function listDestinations(): Promise<Destinations> {
  return db.shippingLeadTimes.findDestinations();
}

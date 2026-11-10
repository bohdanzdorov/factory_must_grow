// Compile-time check that the enums in packages/shared match the Prisma schema.
// If a value is added to one and not the other, typechecking fails on this file.
import type * as Shared from '@factorymustgrow/shared';
import type * as Db from '../generated/prisma/enums.js';

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const enumsInSync: [
  Equals<Db.Capability, Shared.Capability>,
  Equals<Db.SiteStatus, Shared.SiteStatus>,
  Equals<Db.MachineStatus, Shared.MachineStatus>,
  Equals<Db.OrderStatus, Shared.OrderStatus>,
] = [true, true, true, true];

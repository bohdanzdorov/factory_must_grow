// Compile-time check that the enums in packages/shared match the Prisma schema.
// If a value is added to one and not the other, typechecking fails on this file.
// When an enum moves into packages/shared, add it here too.
import type * as Shared from '@factorymustgrow/shared';
import type * as Db from '../generated/prisma/enums.js';

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const enumsInSync: [
  Equals<Db.Capability, Shared.Capability>,
  Equals<Db.SiteStatus, Shared.SiteStatus>,
  Equals<Db.MachineStatus, Shared.MachineStatus>,
  Equals<Db.OrderStatus, Shared.OrderStatus>,
  Equals<Db.JobStatus, Shared.JobStatus>,
  Equals<Db.RoutingDecisionKind, Shared.RoutingDecisionKind>,
  Equals<Db.RoutingDecisionStatus, Shared.RoutingDecisionStatus>,
  Equals<Db.CandidateRejectionReason, Shared.CandidateRejectionReason>,
] = [true, true, true, true, true, true, true, true];

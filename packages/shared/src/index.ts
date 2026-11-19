// The API contract between the backend and its clients, and nothing else: the Zod schemas of
// every request and response, the types inferred from them, and the enums they use.
// No logic lives here. If only one side needs something, it belongs in that app instead.
// One file per resource, matching the API's routes.
export * from './clock.js';
export * from './destination.js';
export * from './enums.js';
export * from './errors.js';
export * from './machine.js';
export * from './order.js';
export * from './routing.js';
export * from './site.js';

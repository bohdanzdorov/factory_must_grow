// Where tests run. Override with TEST_DATABASE_URL (CI does).
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://factory:factory_dev@localhost:5433/factorymustgrow_test';

export function databaseName(url: string): string {
  return new URL(url).pathname.slice(1);
}

// Tests empty every table before each test, so they must never point at a real database.
export function assertTestDatabase(url: string): void {
  const name = databaseName(url);

  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}": its name must end in "_test", because tests delete all data.`,
    );
  }
}

export function ErrorMessage({ error }: { error: Error }) {
  return (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      {error.message}
    </p>
  );
}

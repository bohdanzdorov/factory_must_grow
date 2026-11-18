// The validation message under a form field, if it has one.
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;

  return (
    <p id={id} className="text-sm text-red-700">
      {message}
    </p>
  );
}

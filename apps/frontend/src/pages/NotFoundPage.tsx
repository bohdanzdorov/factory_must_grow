import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/orders" className="text-sm text-blue-700 hover:underline">
        Go to orders
      </Link>
    </div>
  );
}

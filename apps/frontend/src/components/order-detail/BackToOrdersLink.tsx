import { Link } from 'react-router';

export function BackToOrdersLink() {
  return (
    <Link to="/orders" className="text-sm text-slate-500 hover:text-slate-900">
      ← All orders
    </Link>
  );
}

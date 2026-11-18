import { NavLink, Outlet } from 'react-router';
import { SimulatedClock } from './SimulatedClock';

// The frame around every page: the header with navigation and the simulated clock.
export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">Factory Must Grow</span>
            <nav className="flex gap-4 text-sm">
              <NavLink
                to="/orders"
                className={({ isActive }) =>
                  isActive ? 'font-medium text-slate-900' : 'text-slate-500 hover:text-slate-900'
                }
              >
                Orders
              </NavLink>
            </nav>
          </div>
          <SimulatedClock />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

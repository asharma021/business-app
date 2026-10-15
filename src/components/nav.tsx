"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  LayoutGrid, Search, Building2, Store, Sprout, FileText, Calculator, Columns3, Bookmark, Mail, LineChart, Database, Settings, Menu, X, Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme";

const GROUPS = [
  { name: "Find", items: [
    { href: "/", label: "Overview", icon: LayoutGrid },
    { href: "/opportunities", label: "Discover opportunities", icon: Search },
    { href: "/opportunities?type=ACQUISITION", label: "Business acquisitions", icon: Building2 },
    { href: "/opportunities?type=FRANCHISE", label: "Franchises", icon: Store },
    { href: "/emerging", label: "Emerging opportunities", icon: Sprout },
  ] },
  { name: "Analyze", items: [
    { href: "/research", label: "AI research reports", icon: FileText },
    { href: "/calculator", label: "Financial calculator", icon: Calculator },
    { href: "/compare", label: "Compare businesses", icon: Columns3 },
  ] },
  { name: "Track", items: [
    { href: "/watchlist", label: "Watchlist", icon: Bookmark },
    { href: "/reports", label: "Daily intelligence", icon: Mail },
    { href: "/market", label: "Market trends", icon: LineChart },
  ] },
  { name: "System", items: [
    { href: "/sources", label: "Research sources", icon: Database },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];

function isActive(pathname: string, href: string, search: string) {
  const [path, query] = href.split("?");
  if (path === "/") return pathname === "/";
  if (query) return pathname === path && search.includes(query);
  if (path === "/opportunities") return (pathname === "/opportunities" && !/type=/.test(search)) || pathname.startsWith("/opportunities/");
  return pathname.startsWith(path);
}

export function Nav({ email, unread }: { email: string | null; unread: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const search = useSearchParams().toString();

  const list = (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {GROUPS.map((g) => (
        <div key={g.name}>
          <p className="px-2 pb-1 text-xs font-medium text-faint">{g.name}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(pathname, it.href, search);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded px-2 py-1.5 text-sm",
                      active ? "bg-raised font-medium text-ink" : "text-muted hover:bg-raised/60 hover:text-ink",
                    )}
                  >
                    <it.icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{it.label}</span>
                    {it.href === "/" && unread > 0 && <span className="ml-auto rounded bg-loss px-1.5 text-2xs font-semibold text-white">{unread}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <Radar className="h-5 w-5 text-accent" aria-hidden />
      Opportunity Radar
    </Link>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        {brand}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" className="rounded p-2 text-muted hover:bg-raised" aria-label={open ? "Close menu" : "Open menu"}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto border-t border-line bg-surface lg:hidden">
          {list}
        </div>
      )}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center px-5">{brand}</div>
        <div className="flex-1 overflow-y-auto">{list}</div>
        <div className="border-t border-line px-3 py-3">
          <ThemeToggle />
          <form action="/api/signout" method="post" className="mt-1">
            <button className="w-full truncate rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-raised hover:text-ink" title="Sign out">
              Sign out {email ? <span className="text-faint">({email})</span> : null}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

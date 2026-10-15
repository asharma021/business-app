"use client";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const order = ["system", "light", "dark"] as const;
  const next = order[(order.indexOf((theme as (typeof order)[number]) ?? "system") + 1) % 3];
  const Icon = !mounted || theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex h-8 items-center gap-2 rounded px-2 text-sm text-muted hover:bg-raised hover:text-ink"
      aria-label={`Theme: ${mounted ? theme : "system"}. Switch to ${next}.`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="capitalize">{mounted ? theme : "system"}</span>
    </button>
  );
}

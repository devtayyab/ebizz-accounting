/** Monochrome line icons (single grey colour via currentColor, no fills). */
export type IconName =
  | "dashboard" | "sales" | "purchases" | "money" | "inventory"
  | "contacts" | "accounting" | "sun" | "moon" | "signout"
  | "revenue" | "profit" | "arrowIn" | "arrowOut" | "tag" | "plus" | "arrow";

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  sales: <><path d="M4 3h11l5 5v13H4z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></>,
  purchases: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 7H6" /></>,
  money: <><rect x="2.5" y="6" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><circle cx="17" cy="14.5" r="1.4" /></>,
  inventory: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  contacts: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a6 6 0 0 0-3-5.2" /></>,
  accounting: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" /><path d="M9 7h7M9 10.5h7" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" />,
  signout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  revenue: <><polyline points="3 16 9 10 13 14 21 6" /><polyline points="15 6 21 6 21 12" /></>,
  profit: <><path d="M4 20V11M10 20V5M16 20v-6M4 20h16" /></>,
  arrowIn: <><path d="M17 7 8 16" /><path d="M8 9v7h7" /></>,
  arrowOut: <><path d="M7 17 16 8" /><path d="M9 8h7v7" /></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2A2 2 0 0 1 3.8 12V5.8A2 2 0 0 1 5.8 3.8H12a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8z" /><circle cx="8.6" cy="8.6" r="1.1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

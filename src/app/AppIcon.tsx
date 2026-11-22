const paths = {
  brand: "M3 17 9 7h4l-6 10zm9 0 6-10h3l-6 10z",
  calendar:
    "M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 9h2m4 0h2m-8 3h2",
  plan: "M4 7h16M4 12h16M4 17h16M7 7h6m-2 5h6m-9 5h5",
  programs: "M4 8v8m16-8v8M7 5v14M17 5v14M7 12h10",
  metrics: "M4 4v16h16M8 16v-4m5 4V8m5 8V5",
  library: "M4 5h4v14H4zm4 0h4v14H8zm6 1 4-1 3 13-4 1z",
  imports: "M12 15V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  collapseSidebar: "M4 5h16v14H4zM9 5v14m7-10-3 3 3 3",
  expandSidebar: "M4 5h16v14H4zM9 5v14m4-10 3 3-3 3",
  account: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l4 4L19 6",
  nutrition: "M3 13h18a8 8 0 0 1-8 7h-2a8 8 0 0 1-8-7Zm7-3 5-6m-1 6 5-6",
  checkIn: "M3 12h5l3-7 3 14 3-7h4",
};

export const AppIcon = ({ name, size = 20 }: { name: keyof typeof paths; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d={paths[name]}
      fill={name === "brand" ? "currentColor" : "none"}
      stroke={name === "brand" ? "none" : "currentColor"}
      strokeWidth={name === "more" ? 3 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const Wordmark = () => (
  <span className="app-wordmark">
    <span className="app-mark">
      <AppIcon name="brand" size={25} />
    </span>
    Paideuo
  </span>
);

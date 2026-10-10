/** Room color themes. Boom hexes are shared with gantree — do not drift them. */

export type ThemeScheme = "dark" | "light";

export type ThemeFeel = "neutral" | "happy" | "excited" | "sad" | "frustrated" | "angry" | "anxious";

export type ThemeCore = {
  scheme: ThemeScheme;
  canvas: string;
  panel: string;
  track: string;
  line: string;
  edge: string;
  fg: string;
  body: string;
  muted: string;
  dim: string;
  faint: string;
  accent: string;
  accentHover: string;
  mark: string;
  accentLine: string;
  accentSoft: string;
  danger: string;
  dangerLine: string;
  dangerSoft: string;
  ok: string;
  info: string;
};

export type ThemeTokens = ThemeCore & {
  you: string;
  kit: string;
};

export type ThemeDef = {
  id: string;
  label: string;
  feel: ThemeFeel;
  /** One line for the agent. `<feel>, <scheme> — <scene>`. */
  mood: string;
  tokens: ThemeTokens;
};

/** Shared with gantree — do not drift these hex values. */
const BOOM = {
  scheme: "dark",
  canvas: "#0e1316",
  panel: "#171d22",
  track: "#232b32",
  line: "#3a4550",
  edge: "#5c6772",
  fg: "#f4f0ea",
  body: "#dcd6ce",
  muted: "#9aa3ab",
  dim: "#84909a",
  faint: "#5a6570",
  accent: "#f07848",
  accentHover: "#f89068",
  mark: "#f3b199",
  accentLine: "#c24a28",
  accentSoft: "#2a1612",
  danger: "#e070a0",
  dangerLine: "#a03860",
  dangerSoft: "#2a121c",
  ok: "#3db8a0",
  info: "#6ba8c9",
} as const satisfies ThemeCore;

const PAPER = {
  scheme: "light",
  canvas: "#f6f1e8",
  panel: "#efe8dc",
  track: "#e4dccf",
  line: "#8e8270",
  edge: "#5a5248",
  fg: "#1c1814",
  body: "#2e2822",
  muted: "#524a42",
  dim: "#5c544c",
  faint: "#6e665c",
  accent: "#c24a28",
  accentHover: "#a83c1c",
  mark: "#8a2808",
  accentLine: "#a83818",
  accentSoft: "#f3d8cc",
  danger: "#b42858",
  dangerLine: "#8a1840",
  dangerSoft: "#f8dce6",
  ok: "#1a7a64",
  info: "#24608c",
} as const satisfies ThemeCore;

const INK = {
  scheme: "dark",
  canvas: "#050506",
  panel: "#141416",
  track: "#262628",
  line: "#6a6a70",
  edge: "#9a9aa0",
  fg: "#fafafa",
  body: "#e4e4e6",
  muted: "#b0b0b6",
  dim: "#c4c4ca",
  faint: "#8a8a92",
  accent: "#f0b020",
  accentHover: "#f8c040",
  mark: "#ffe08a",
  accentLine: "#c88810",
  accentSoft: "#2a220c",
  danger: "#f07090",
  dangerLine: "#c03858",
  dangerSoft: "#2a1018",
  ok: "#3cc8a8",
  info: "#7ab0e0",
} as const satisfies ThemeCore;

const MARQUEE = {
  scheme: "dark",
  canvas: "#141a3c",
  panel: "#1c2450",
  track: "#283064",
  line: "#46508c",
  edge: "#7a84b8",
  fg: "#fff8e6",
  body: "#e6e0d0",
  muted: "#b0b4d8",
  dim: "#9aa0c8",
  faint: "#6c74a4",
  accent: "#ffcc33",
  accentHover: "#ffd966",
  mark: "#ffe599",
  accentLine: "#c99a10",
  accentSoft: "#332a12",
  danger: "#ff6b9d",
  dangerLine: "#b83a66",
  dangerSoft: "#3a1828",
  ok: "#3ad0a0",
  info: "#58c4ff",
} as const satisfies ThemeCore;

const LEMONADE = {
  scheme: "light",
  canvas: "#fff6cc",
  panel: "#fff0b0",
  track: "#f7e690",
  line: "#a89440",
  edge: "#6e6020",
  fg: "#1a1606",
  body: "#2e2810",
  muted: "#5a5020",
  dim: "#665c28",
  faint: "#78703a",
  accent: "#1f52e0",
  accentHover: "#1842b8",
  mark: "#10308c",
  accentLine: "#1842b8",
  accentSoft: "#dde6ff",
  danger: "#c0184c",
  dangerLine: "#8e1038",
  dangerSoft: "#ffdce6",
  ok: "#167a4a",
  info: "#1f52e0",
} as const satisfies ThemeCore;

const NEON = {
  scheme: "dark",
  canvas: "#120a1e",
  panel: "#1b1030",
  track: "#281848",
  line: "#4a2e7a",
  edge: "#7e58b8",
  fg: "#fdf2ff",
  body: "#e6d8f2",
  muted: "#b89ad8",
  dim: "#a088c4",
  faint: "#7e62a8",
  accent: "#ff2d95",
  accentHover: "#ff5cad",
  mark: "#ffa6d2",
  accentLine: "#c0106a",
  accentSoft: "#3a1030",
  danger: "#ff5a5a",
  dangerLine: "#b02a2a",
  dangerSoft: "#3a1414",
  ok: "#2ef2b0",
  info: "#38e0ff",
} as const satisfies ThemeCore;

const FIZZ = {
  scheme: "light",
  canvas: "#e6fbff",
  panel: "#d2f4fb",
  track: "#bceaf4",
  line: "#4e8a98",
  edge: "#2e5c68",
  fg: "#081a20",
  body: "#142a32",
  muted: "#2e5260",
  dim: "#3a5e6c",
  faint: "#4e7482",
  accent: "#e0107a",
  accentHover: "#c00c66",
  mark: "#8e0848",
  accentLine: "#c00c66",
  accentSoft: "#ffd6ea",
  danger: "#c4123a",
  dangerLine: "#8e0c2a",
  dangerSoft: "#ffdada",
  ok: "#0e7a5a",
  info: "#0e5c9c",
} as const satisfies ThemeCore;

const RAIN = {
  scheme: "dark",
  canvas: "#0f131f",
  panel: "#161c2c",
  track: "#20283c",
  line: "#364260",
  edge: "#5c6a90",
  fg: "#e8ecf8",
  body: "#c8d0e4",
  muted: "#8e9ac0",
  dim: "#8894ba",
  faint: "#5e6c8c",
  accent: "#8c9fe6",
  accentHover: "#a4b4f0",
  mark: "#c8d4ff",
  accentLine: "#4e60a8",
  accentSoft: "#1a2040",
  danger: "#d06a90",
  dangerLine: "#90365a",
  dangerSoft: "#281420",
  ok: "#5cb09a",
  info: "#78a0d8",
} as const satisfies ThemeCore;

const MIST = {
  scheme: "light",
  canvas: "#eceef6",
  panel: "#e0e3ee",
  track: "#d0d4e4",
  line: "#7e86a4",
  edge: "#505870",
  fg: "#14161e",
  body: "#22262e",
  muted: "#464c62",
  dim: "#4c526a",
  faint: "#646c84",
  accent: "#4a56a8",
  accentHover: "#3c4690",
  mark: "#2a3270",
  accentLine: "#3c4690",
  accentSoft: "#d8dcf6",
  danger: "#b02858",
  dangerLine: "#86183e",
  dangerSoft: "#f4dae4",
  ok: "#1e7462",
  info: "#3c5c98",
} as const satisfies ThemeCore;

const FUSE = {
  scheme: "dark",
  canvas: "#17150f",
  panel: "#201d14",
  track: "#2c281c",
  line: "#4e4830",
  edge: "#7c7450",
  fg: "#fbf4e6",
  body: "#e2d8c4",
  muted: "#aea48a",
  dim: "#a0967e",
  faint: "#746c50",
  accent: "#ff7a00",
  accentHover: "#ff9633",
  mark: "#ffbf80",
  accentLine: "#c45a00",
  accentSoft: "#33200a",
  danger: "#ff5a6e",
  dangerLine: "#b02a3c",
  dangerSoft: "#341418",
  ok: "#86c46a",
  info: "#e0b830",
} as const satisfies ThemeCore;

const GRIT = {
  scheme: "light",
  canvas: "#f3efe4",
  panel: "#e9e3d2",
  track: "#dcd4bc",
  line: "#8a8060",
  edge: "#5a5238",
  fg: "#1a1810",
  body: "#2c2818",
  muted: "#504a30",
  dim: "#5a543a",
  faint: "#6c664a",
  accent: "#d2500a",
  accentHover: "#b44208",
  mark: "#8a3004",
  accentLine: "#b44208",
  accentSoft: "#ffdcc4",
  danger: "#b4203a",
  dangerLine: "#881428",
  dangerSoft: "#f8d8da",
  ok: "#4a7a1e",
  info: "#806400",
} as const satisfies ThemeCore;

const SIREN = {
  scheme: "dark",
  canvas: "#160608",
  panel: "#200a0e",
  track: "#2e1016",
  line: "#58202a",
  edge: "#8e3a48",
  fg: "#fff2f2",
  body: "#ecd4d6",
  muted: "#c09aa0",
  dim: "#ae8a90",
  faint: "#7e5660",
  accent: "#ff2e3f",
  accentHover: "#ff5c6a",
  mark: "#ffa0a8",
  accentLine: "#c0101e",
  accentSoft: "#3e0c12",
  danger: "#ff6ab8",
  dangerLine: "#b8307a",
  dangerSoft: "#3a1028",
  ok: "#46d08a",
  info: "#ffb020",
} as const satisfies ThemeCore;

const FLARE = {
  scheme: "light",
  canvas: "#fff0ee",
  panel: "#fde0dc",
  track: "#f6ccc6",
  line: "#a06860",
  edge: "#6a4038",
  fg: "#1e0a0a",
  body: "#301616",
  muted: "#5a3030",
  dim: "#663a3a",
  faint: "#7a4c4c",
  accent: "#d4102c",
  accentHover: "#b00c22",
  mark: "#880818",
  accentLine: "#b00c22",
  accentSoft: "#ffd4d4",
  danger: "#b0147a",
  dangerLine: "#860c5a",
  dangerSoft: "#fcd8ee",
  ok: "#1a7a4e",
  info: "#9a5a00",
} as const satisfies ThemeCore;

const STATIC = {
  scheme: "dark",
  canvas: "#0d1410",
  panel: "#141c17",
  track: "#1e2a22",
  line: "#37493d",
  edge: "#5e7866",
  fg: "#f0f8f2",
  body: "#d2dcd6",
  muted: "#9ab0a2",
  dim: "#8aa092",
  faint: "#5e7466",
  accent: "#b388ff",
  accentHover: "#c6a4ff",
  mark: "#dcc8ff",
  accentLine: "#7a4ee0",
  accentSoft: "#221a38",
  danger: "#ff6a8a",
  dangerLine: "#b0304e",
  dangerSoft: "#341420",
  ok: "#52d490",
  info: "#d8f03c",
} as const satisfies ThemeCore;

const FLICKER = {
  scheme: "light",
  canvas: "#eef7f0",
  panel: "#dff0e4",
  track: "#cce4d4",
  line: "#6a8e78",
  edge: "#40604c",
  fg: "#0e1a12",
  body: "#1a2a20",
  muted: "#365244",
  dim: "#425e50",
  faint: "#547062",
  accent: "#6a2fd0",
  accentHover: "#5824b0",
  mark: "#3e1484",
  accentLine: "#5824b0",
  accentSoft: "#e8dcff",
  danger: "#b4204e",
  dangerLine: "#880e38",
  dangerSoft: "#f8d8e2",
  ok: "#1a7a4a",
  info: "#4a5ab8",
} as const satisfies ThemeCore;

export const THEMES = [
  {
    id: "boom",
    label: "Boom",
    feel: "neutral",
    mood: "neutral, dark — warm workshop: charcoal floor, rust-orange tools",
    tokens: { ...BOOM, you: "#3a1e16", kit: BOOM.track } satisfies ThemeTokens,
  },
  {
    id: "paper",
    label: "Paper",
    feel: "neutral",
    mood: "neutral, light — day workshop: cream paper, rust-orange tools",
    tokens: { ...PAPER, you: "#e4c4b0", kit: PAPER.track } satisfies ThemeTokens,
  },
  {
    id: "ink",
    label: "Ink",
    feel: "neutral",
    mood: "neutral, dark — high-contrast night: black floor, white type, amber lamp",
    tokens: { ...INK, you: "#3a2410", kit: INK.track } satisfies ThemeTokens,
  },
  {
    id: "marquee",
    label: "Marquee",
    feel: "happy",
    mood: "happy, dark — opening-night marquee: royal indigo, gold bulbs",
    tokens: { ...MARQUEE, you: "#2a2470", kit: MARQUEE.track } satisfies ThemeTokens,
  },
  {
    id: "lemonade",
    label: "Lemonade",
    feel: "happy",
    mood: "happy, light — lemonade stand at noon: butter yellow, cobalt lettering",
    tokens: { ...LEMONADE, you: "#ffd84d", kit: LEMONADE.track } satisfies ThemeTokens,
  },
  {
    id: "neon",
    label: "Neon",
    feel: "excited",
    mood: "excited, dark — blacklight arcade: violet black, hot-pink tube",
    tokens: { ...NEON, you: "#3a1458", kit: NEON.track } satisfies ThemeTokens,
  },
  {
    id: "fizz",
    label: "Fizz",
    feel: "excited",
    mood: "excited, light — cream soda: ice cyan, hot-pink straw",
    tokens: { ...FIZZ, you: "#b0eefc", kit: FIZZ.track } satisfies ThemeTokens,
  },
  {
    id: "rain",
    label: "Rain",
    feel: "sad",
    mood: "sad, dark — rain on the window: slate indigo, periwinkle streetlight",
    tokens: { ...RAIN, you: "#1e2644", kit: RAIN.track } satisfies ThemeTokens,
  },
  {
    id: "mist",
    label: "Mist",
    feel: "sad",
    mood: "sad, light — overcast morning: lavender grey, slate-indigo ink",
    tokens: { ...MIST, you: "#c8ccec", kit: MIST.track } satisfies ThemeTokens,
  },
  {
    id: "fuse",
    label: "Fuse",
    feel: "frustrated",
    mood: "frustrated, dark — lit fuse: charcoal khaki, safety orange",
    tokens: { ...FUSE, you: "#332a16", kit: FUSE.track } satisfies ThemeTokens,
  },
  {
    id: "grit",
    label: "Grit",
    feel: "frustrated",
    mood: "frustrated, light — sandpaper: khaki white, burnt orange",
    tokens: { ...GRIT, you: "#ead29a", kit: GRIT.track } satisfies ThemeTokens,
  },
  {
    id: "siren",
    label: "Siren",
    feel: "angry",
    mood: "angry, dark — siren at night: black red, scarlet",
    tokens: { ...SIREN, you: "#3a0e18", kit: SIREN.track } satisfies ThemeTokens,
  },
  {
    id: "flare",
    label: "Flare",
    feel: "angry",
    mood: "angry, light — road flare at noon: blush white, crimson",
    tokens: { ...FLARE, you: "#ffc2bc", kit: FLARE.track } satisfies ThemeTokens,
  },
  {
    id: "static",
    label: "Static",
    feel: "anxious",
    mood: "anxious, dark — CRT static: green black, electric violet",
    tokens: { ...STATIC, you: "#26203c", kit: STATIC.track } satisfies ThemeTokens,
  },
  {
    id: "flicker",
    label: "Flicker",
    feel: "anxious",
    mood: "anxious, light — fluorescent flicker: pale mint, deep violet",
    tokens: { ...FLICKER, you: "#d8d0f8", kit: FLICKER.track } satisfies ThemeTokens,
  },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "boom";

export type ThemeCard = {
  id: ThemeId;
  label: string;
  feel: ThemeFeel;
  scheme: ThemeScheme;
  mood: string;
  canvas: string;
  accent: string;
};

const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

export function knownTheme(v: unknown): ThemeId | null {
  return typeof v === "string" && THEME_IDS.includes(v) ? (v as ThemeId) : null;
}

export function parseTheme(v: unknown): ThemeId {
  return knownTheme(v) ?? DEFAULT_THEME;
}

export function themeOf(id: ThemeId = DEFAULT_THEME) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** What the agent (and GET /api/theme) sees: id, feel, scheme, mood, the two signature hexes. */
export function themeCards(): ThemeCard[] {
  return THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    feel: t.feel,
    scheme: t.tokens.scheme,
    mood: t.mood,
    canvas: t.tokens.canvas,
    accent: t.tokens.accent,
  }));
}

export function themeIdList(): readonly string[] {
  return THEME_IDS;
}

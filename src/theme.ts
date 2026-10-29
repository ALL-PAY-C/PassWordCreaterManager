import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from "@material/material-color-utilities";

export type Roles = Record<string, string>;

export const LIGHT: Roles = {
  primary: "#6750A4",
  onPrimary: "#FFFFFF",
  primaryContainer: "#EADDFF",
  onPrimaryContainer: "#21005D",
  secondary: "#635A75",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E8DEF8",
  onSecondaryContainer: "#1D192B",
  tertiary: "#7D5260",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#FFD8E4",
  onTertiaryContainer: "#31111D",
  surface: "#FEF7FF",
  surfaceContainerLow: "#F7F2FA",
  surfaceContainer: "#F3EDF7",
  surfaceContainerHigh: "#ECE6F0",
  surfaceContainerHighest: "#E6E0E9",
  onSurface: "#1D1B20",
  onSurfaceVariant: "#49454F",
  outline: "#79747E",
  outlineVariant: "#CAC4D0",
  inverseSurface: "#322F35",
  inverseOnSurface: "#F5EFF7",
  inversePrimary: "#D0BCFF",
  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",
};

export const DARK: Roles = {
  primary: "#D2BCFC",
  onPrimary: "#32226F",
  primaryContainer: "#4C3889",
  onPrimaryContainer: "#E9DDFF",
  secondary: "#CDC1E1",
  onSecondary: "#342D44",
  secondaryContainer: "#4B425D",
  onSecondaryContainer: "#E9DDFD",
  tertiary: "#EFB8C8",
  onTertiary: "#492532",
  tertiaryContainer: "#6C3644",
  onTertiaryContainer: "#FDDAE1",
  surface: "#141317",
  surfaceContainerLow: "#1C1B1F",
  surfaceContainer: "#201F23",
  surfaceContainerHigh: "#2B292D",
  surfaceContainerHighest: "#363438",
  onSurface: "#E4E1E7",
  onSurfaceVariant: "#C9C4D1",
  outline: "#938F9B",
  outlineVariant: "#494550",
  inverseSurface: "#E4E1E7",
  inverseOnSurface: "#313034",
  inversePrimary: "#6750A4",
  error: "#F2B8B5",
  onError: "#601410",
  errorContainer: "#8C1D18",
  onErrorContainer: "#F9DEDC",
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "紫", hex: "#6750A4" },
  { name: "蓝", hex: "#2E5AA8" },
  { name: "绿", hex: "#2C6B4F" },
  { name: "橙", hex: "#8A4E00" },
  { name: "粉", hex: "#8C4A63" },
];

/** Build a full role set from a seed colour using Material colour utilities. */
export function schemeFromSeed(hex: string, isDark: boolean): Roles {
  const theme = themeFromSourceColor(argbFromHex(hex));
  const scheme = (isDark ? theme.schemes.dark : theme.schemes.light).toJSON() as unknown as Record<string, string | number>;
  const base = isDark ? DARK : LIGHT;
  const out: Roles = { ...base };
  for (const key of Object.keys(base)) {
    const raw = (scheme as Record<string, unknown>)[key];
    if (typeof raw === "number") out[key] = hexFromArgb(raw);
    else if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

export function applyRoles(roles: Roles) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(roles)) {
    root.style.setProperty("--md-sys-color-" + kebab(key), value);
  }
}

import {ReactNode, createContext, useContext, useEffect, useMemo, useState} from 'react';

import {kvStore} from '../platform/storage/kvStore';
import {colors} from './theme';

type StaticThemeColors = typeof colors;
export type ThemeColors = {
  [K in keyof StaticThemeColors]: string;
};
export type BaseThemeColors = Pick<
  ThemeColors,
  'backgroundBase' | 'backgroundElevated' | 'backgroundCard' | 'borderSubtle' | 'borderStrong' | 'textPrimary' | 'textSecondary' | 'textMuted'
>;
export type HighlightThemeColors = Pick<
  ThemeColors,
  'accentPrimary' | 'accentSuccess' | 'accentWarning' | 'accentDanger'
>;

export type BaseThemePreset = {
  id: string;
  label: string;
  colors: BaseThemeColors;
};

export type HighlightThemePreset = {
  id: string;
  label: string;
  colors: HighlightThemeColors;
};

export type ThemePreset = {
  id: string;
  label: string;
  colors: ThemeColors;
};

export type FontOption = {
  id: string;
  label: string;
  fontFamily: string;
};

function composeThemeColors(base: BaseThemeColors, highlight: HighlightThemeColors): ThemeColors {
  return {
    ...base,
    ...highlight,
  };
}

function extractBaseThemeColors(source: ThemeColors): BaseThemeColors {
  return {
    backgroundBase: source.backgroundBase,
    backgroundElevated: source.backgroundElevated,
    backgroundCard: source.backgroundCard,
    borderSubtle: source.borderSubtle,
    borderStrong: source.borderStrong,
    textPrimary: source.textPrimary,
    textSecondary: source.textSecondary,
    textMuted: source.textMuted,
  };
}

function extractHighlightThemeColors(source: ThemeColors): HighlightThemeColors {
  return {
    accentPrimary: source.accentPrimary,
    accentSuccess: source.accentSuccess,
    accentWarning: source.accentWarning,
    accentDanger: source.accentDanger,
  };
}

const defaultBaseColors = extractBaseThemeColors(colors);
const defaultHighlightColors = extractHighlightThemeColors(colors);

export const baseThemePresets: BaseThemePreset[] = [
  {
    id: 'default_dark',
    label: 'Holo Blue',
    colors: {
      ...defaultBaseColors,
    },
  },
  {
    id: 'cosmic_purple',
    label: 'Cosmic Purple',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#110F1A',
      backgroundElevated: '#1B1630',
      backgroundCard: '#241E3B',
      borderSubtle: '#3A3158',
      borderStrong: '#4B3F72',
      textPrimary: '#EFE9FF',
      textSecondary: '#C4B6F0',
      textMuted: '#9C90C9',
    },
  },
  {
    id: 'zappy_orange',
    label: 'Zappy Orange',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#17110B',
      backgroundElevated: '#24180F',
      backgroundCard: '#2D1F14',
      borderSubtle: '#493224',
      borderStrong: '#61402B',
      textPrimary: '#FFF2E6',
      textSecondary: '#F2C9A8',
      textMuted: '#C79D7B',
    },
  },
  {
    id: 'battle_red',
    label: 'Battle Red',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#160B0D',
      backgroundElevated: '#221114',
      backgroundCard: '#2C171B',
      borderSubtle: '#4A252B',
      borderStrong: '#65313A',
      textPrimary: '#FFECEF',
      textSecondary: '#F2C3CB',
      textMuted: '#C7959F',
    },
  },
  {
    id: 'angel_white',
    label: 'Angel White',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#F4F5F7',
      backgroundElevated: '#FFFFFF',
      backgroundCard: '#FFFFFF',
      borderSubtle: '#D5DAE1',
      borderStrong: '#B8C0CB',
      textPrimary: '#1A2230',
      textSecondary: '#3F4D63',
      textMuted: '#68758A',
    },
  },
  {
    id: 'gun_metal',
    label: 'Gun Metal',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#0F1318',
      backgroundElevated: '#171D24',
      backgroundCard: '#1F2731',
      borderSubtle: '#2F3A47',
      borderStrong: '#405063',
      textPrimary: '#E8EEF6',
      textSecondary: '#B8C7D8',
      textMuted: '#8D9BAA',
    },
  },
  {
    id: 'matrix_green',
    label: 'Matrix Green',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#080F0A',
      backgroundElevated: '#0D1711',
      backgroundCard: '#132018',
      borderSubtle: '#1E3A2A',
      borderStrong: '#2C5C41',
      textPrimary: '#DFFFEA',
      textSecondary: '#A6D8B8',
      textMuted: '#73A284',
    },
  },
  {
    id: 'yellow_jacket',
    label: 'Yellow Jacket',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#171408',
      backgroundElevated: '#221C0D',
      backgroundCard: '#2D2510',
      borderSubtle: '#4B3E18',
      borderStrong: '#685623',
      textPrimary: '#FFF7DC',
      textSecondary: '#E6D59E',
      textMuted: '#BDAE78',
    },
  },
  {
    id: 'midnight_black',
    label: 'Midnight Black',
    colors: {
      ...defaultBaseColors,
      backgroundBase: '#050608',
      backgroundElevated: '#0A0C0F',
      backgroundCard: '#111418',
      borderSubtle: '#1E232B',
      borderStrong: '#2F3640',
      textPrimary: '#F1F5FA',
      textSecondary: '#C2CBD8',
      textMuted: '#8D98A8',
    },
  },
];

export const highlightThemePresets: HighlightThemePreset[] = [
  {
    id: 'holo_blue',
    label: 'Holo Blue',
    colors: {
      ...defaultHighlightColors,
    },
  },
  {
    id: 'cosmic_purple',
    label: 'Cosmic Purple',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#B38CFF',
      accentSuccess: '#7BFFCC',
      accentWarning: '#FFD17A',
      accentDanger: '#FF7AB6',
    },
  },
  {
    id: 'zappy_orange',
    label: 'Zappy Orange',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#FF9B3D',
      accentSuccess: '#7DFFB4',
      accentWarning: '#FFD166',
      accentDanger: '#FF7A5C',
    },
  },
  {
    id: 'battle_red',
    label: 'Battle Red',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#C9303E',
      accentSuccess: '#6ED8A1',
      accentWarning: '#F3BE5B',
      accentDanger: '#FF5C74',
    },
  },
  {
    id: 'angel_white',
    label: 'Angel White',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#6E82FF',
      accentSuccess: '#2EA56E',
      accentWarning: '#C58A21',
      accentDanger: '#C1455A',
    },
  },
  {
    id: 'gun_metal',
    label: 'Gun Metal',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#7A90A8',
      accentSuccess: '#57C59B',
      accentWarning: '#D8B35A',
      accentDanger: '#D6727E',
    },
  },
  {
    id: 'matrix_green',
    label: 'Matrix Green',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#4CFF88',
      accentSuccess: '#70FFAF',
      accentWarning: '#C9F279',
      accentDanger: '#FF6F9A',
    },
  },
  {
    id: 'yellow_jacket',
    label: 'Yellow Jacket',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#FFD447',
      accentSuccess: '#B6E857',
      accentWarning: '#FFB020',
      accentDanger: '#FF6B4A',
    },
  },
  {
    id: 'midnight_black',
    label: 'Midnight Black',
    colors: {
      ...defaultHighlightColors,
      accentPrimary: '#7FAEFF',
      accentSuccess: '#5ED6B8',
      accentWarning: '#FFC86B',
      accentDanger: '#FF7C98',
    },
  },
];

export const defaultBaseThemePreset: BaseThemePreset = baseThemePresets[0];
export const defaultHighlightThemePreset: HighlightThemePreset = highlightThemePresets[0];
export const themePresets: ThemePreset[] = baseThemePresets.map(item => ({
  id: item.id,
  label: item.label,
  colors: composeThemeColors(item.colors, defaultHighlightThemePreset.colors),
}));
export const defaultThemePreset: ThemePreset = themePresets[0];
export const fontOptions: FontOption[] = [
  {
    id: 'aldrich',
    label: 'Aldrich',
    fontFamily: 'Aldrich-Regular',
  },
  {
    id: 'system',
    label: 'System',
    fontFamily: 'System',
  },
];
export const defaultFontOption: FontOption = fontOptions[0];
const THEME_STORAGE_KEY = 'android_music_player.theme.v1';

type ThemeContextValue = {
  colors: ThemeColors;
  activeBasePresetId: string;
  activeHighlightPresetId: string;
  activePresetId: string;
  activeFontOptionId: string;
  fontFamily: string;
  applyBasePreset: (presetId: string) => void;
  applyHighlightPreset: (presetId: string) => void;
  applyPreset: (presetId: string) => void;
  applyFontOption: (fontOptionId: string) => void;
  setThemeColors: (next: ThemeColors) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
  initialColors?: ThemeColors;
};

export function ThemeProvider({children, initialColors = colors}: ThemeProviderProps) {
  const [baseThemeColors, setBaseThemeColors] = useState<BaseThemeColors>(extractBaseThemeColors(initialColors));
  const [highlightThemeColors, setHighlightThemeColors] = useState<HighlightThemeColors>(extractHighlightThemeColors(initialColors));
  const [activeBasePresetId, setActiveBasePresetId] = useState(defaultBaseThemePreset.id);
  const [activeHighlightPresetId, setActiveHighlightPresetId] = useState(defaultHighlightThemePreset.id);
  const [activeFontOptionId, setActiveFontOptionId] = useState(defaultFontOption.id);

  const themeColors = useMemo(() => composeThemeColors(baseThemeColors, highlightThemeColors), [baseThemeColors, highlightThemeColors]);

  const applyBasePreset = (presetId: string) => {
    const nextPreset = baseThemePresets.find(item => item.id === presetId);
    if (!nextPreset) {
      return;
    }

    setBaseThemeColors(nextPreset.colors);
    setActiveBasePresetId(nextPreset.id);
  };

  const applyPreset = (presetId: string) => {
    const nextPreset = baseThemePresets.find(item => item.id === presetId);
    if (!nextPreset) {
      return;
    }

    setBaseThemeColors(nextPreset.colors);
    setActiveBasePresetId(nextPreset.id);
  };

  const applyHighlightPreset = (presetId: string) => {
    const nextPreset = highlightThemePresets.find(item => item.id === presetId);
    if (!nextPreset) {
      return;
    }

    setHighlightThemeColors(nextPreset.colors);
    setActiveHighlightPresetId(nextPreset.id);
  };

  const applyFontOption = (fontOptionId: string) => {
    const nextFontOption = fontOptions.find(item => item.id === fontOptionId);
    if (!nextFontOption) {
      return;
    }

    setActiveFontOptionId(nextFontOption.id);
  };

  useEffect(() => {
    let cancelled = false;

    const restoreTheme = async () => {
      try {
        const raw = kvStore.getItem(THEME_STORAGE_KEY);
        if (!raw || cancelled) {
          return;
        }

        const parsed = JSON.parse(raw) as {
          activePresetId?: string;
          activeBasePresetId?: string;
          activeHighlightPresetId?: string;
          activeFontOptionId?: string;
          colors?: ThemeColors;
          baseColors?: BaseThemeColors;
          highlightColors?: HighlightThemeColors;
        };

        if (parsed.baseColors) {
          setBaseThemeColors(parsed.baseColors);
        } else if (parsed.colors) {
          setBaseThemeColors(extractBaseThemeColors(parsed.colors));
        }

        if (parsed.highlightColors) {
          setHighlightThemeColors(parsed.highlightColors);
        } else if (parsed.colors) {
          setHighlightThemeColors(extractHighlightThemeColors(parsed.colors));
        }

        if (typeof parsed.activeBasePresetId === 'string' && parsed.activeBasePresetId.trim()) {
          if (baseThemePresets.some(item => item.id === parsed.activeBasePresetId)) {
            setActiveBasePresetId(parsed.activeBasePresetId);
          }
        }

        if (typeof parsed.activeHighlightPresetId === 'string' && parsed.activeHighlightPresetId.trim()) {
          if (highlightThemePresets.some(item => item.id === parsed.activeHighlightPresetId)) {
            setActiveHighlightPresetId(parsed.activeHighlightPresetId);
          }
        }

        if (typeof parsed.activePresetId === 'string' && parsed.activePresetId.trim()) {
          if (baseThemePresets.some(item => item.id === parsed.activePresetId)) {
            setActiveBasePresetId(parsed.activePresetId);
          }
          if (highlightThemePresets.some(item => item.id === parsed.activePresetId)) {
            setActiveHighlightPresetId(parsed.activePresetId);
          }
        }
        if (typeof parsed.activeFontOptionId === 'string' && fontOptions.some(item => item.id === parsed.activeFontOptionId)) {
          setActiveFontOptionId(parsed.activeFontOptionId);
        }
      } catch {
        return;
      }
    };

    void restoreTheme();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      activePresetId: activeBasePresetId,
      activeBasePresetId,
      activeHighlightPresetId,
      activeFontOptionId,
      colors: themeColors,
      baseColors: baseThemeColors,
      highlightColors: highlightThemeColors,
    });

    kvStore.setItem(THEME_STORAGE_KEY, payload);
  }, [activeBasePresetId, activeFontOptionId, activeHighlightPresetId, baseThemeColors, highlightThemeColors, themeColors]);

  const fontFamily = useMemo(
    () => fontOptions.find(item => item.id === activeFontOptionId)?.fontFamily ?? defaultFontOption.fontFamily,
    [activeFontOptionId],
  );

  const value = useMemo(
    () => ({
      colors: themeColors,
      activeBasePresetId,
      activeHighlightPresetId,
      activePresetId: activeBasePresetId,
      activeFontOptionId,
      fontFamily,
      applyBasePreset,
      applyHighlightPreset,
      applyPreset,
      applyFontOption,
      setThemeColors: (next: ThemeColors) => {
        setBaseThemeColors(extractBaseThemeColors(next));
        setHighlightThemeColors(extractHighlightThemeColors(next));
      },
    }),
    [
      activeBasePresetId,
      activeFontOptionId,
      activeHighlightPresetId,
      fontFamily,
      themeColors,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}

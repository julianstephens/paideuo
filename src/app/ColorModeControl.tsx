import { NativeSelect, Stack } from "@chakra-ui/react";
import { createContext, useContext, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { FormField } from "../components/ui";

const storageKey = "paideuo-color-mode";
const systemQuery = "(prefers-color-scheme: dark)";
const choices = ["system", "light", "dark"] as const;
type ColorMode = (typeof choices)[number];

const parseMode = (value: string | null | undefined): ColorMode =>
  value === "light" || value === "dark" ? value : "system";

const ColorModeContext = createContext<{ mode: ColorMode; selectMode: (mode: ColorMode) => void }>({
  mode: "system",
  selectMode: () => undefined,
});

export const ColorModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState(() => parseMode(document.documentElement.dataset.colorMode));

  useEffect(() => {
    const media = window.matchMedia(systemQuery);
    const apply = () => {
      const root = document.documentElement;
      const dark = mode === "dark" || (mode === "system" && media.matches);
      root.dataset.colorMode = mode;
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setMode(parseMode(event.newValue));
    };

    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const selectMode = (next: ColorMode) => {
    setMode(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The selected appearance still applies in this tab.
    }
  };

  return (
    <ColorModeContext.Provider value={{ mode, selectMode }}>{children}</ColorModeContext.Provider>
  );
};

export const ColorModeControl = () => {
  const { mode, selectMode } = useContext(ColorModeContext);
  const id = useId();

  return (
    <Stack gap="1.5">
      <FormField htmlFor={id}>Appearance</FormField>
      <NativeSelect.Root>
        <NativeSelect.Field
          id={id}
          value={mode}
          onChange={(event) => selectMode(parseMode(event.target.value))}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice[0].toUpperCase() + choice.slice(1)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Stack>
  );
};

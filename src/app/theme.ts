import {
  createSystem,
  defaultConfig,
  defineConfig,
  defineRecipe,
  defineSlotRecipe,
} from "@chakra-ui/react";

const fieldTextSize = { base: "md", md: "sm" };

const color = (light: string, dark: string) => ({
  value: { base: light, _light: light, _dark: dark },
});

export const theme = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: { colorPalette: "teal" },
      body: { bg: "bg.canvas", color: "fg", fontVariantNumeric: "tabular-nums" },
      "*": { focusRingColor: "focusRing" },
      "a:focus-visible, summary:focus-visible, [tabindex]:focus-visible": {
        outline: "2px solid",
        outlineColor: "focusRing",
        outlineOffset: "2px",
      },
      "main a": { color: "teal.fg", minH: { base: "11", md: "0" } },
    },
    theme: {
      tokens: {
        fonts: {
          heading: { value: "system-ui, sans-serif" },
          body: { value: "system-ui, sans-serif" },
        },
      },
      semanticTokens: {
        colors: {
          bg: {
            DEFAULT: color("#ffffff", "#171f2b"),
            canvas: color("#f1f5f9", "#101722"),
            panel: color("#ffffff", "#171f2b"),
            inset: color("#edf2f7", "#202b39"),
          },
          fg: {
            DEFAULT: color("#152234", "#f0f4f8"),
            muted: color("#4b5b70", "#b7c4d3"),
          },
          border: {
            DEFAULT: color("#cbd5e1", "#3b4b5e"),
            control: color("#64748b", "#8b9eb5"),
          },
          focusRing: color("#08756d", "#70e5ce"),
          teal: {
            solid: color("#08665e", "#70e5ce"),
            contrast: color("#ffffff", "#102520"),
            fg: color("#075e56", "#91ecdb"),
            subtle: color("#d9f2ed", "#203d3b"),
            muted: color("#bfe7df", "#2a4b47"),
            border: color("#47867d", "#65958c"),
          },
        },
      },
      slotRecipes: {
        segmentGroup: defineSlotRecipe({
          slots: ["root", "item", "indicator"],
          base: {
            root: {
              bg: "bg.inset",
              borderWidth: "1px",
              borderColor: "border",
              boxShadow: "none",
              "--segment-indicator-bg": "colors.colorPalette.solid",
              "--segment-indicator-shadow": "none",
            },
            item: {
              "&[data-state=unchecked]:not([data-disabled]):hover": { bg: "bg.panel" },
              "&[data-state=checked]": { color: "colorPalette.contrast" },
              "&[data-state=checked][data-ssr]": {
                bg: "colorPalette.solid",
                shadow: "none",
              },
            },
          },
        }),
        nativeSelect: defineSlotRecipe({
          slots: ["root", "field", "indicator"],
          variants: {
            size: {
              md: {
                root: { "--select-field-height": { base: "sizes.11", md: "sizes.10" } },
                field: { textStyle: fieldTextSize },
              },
            },
            variant: { outline: { field: { borderColor: "border.control" } } },
          },
        }),
      },
      recipes: {
        button: defineRecipe({
          base: {
            minH: { base: "11", md: "unset" },
            maxW: "full",
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          },
          variants: {
            variant: {
              outline: {
                color: "fg",
                borderColor: "border.control",
                _hover: { bg: "bg.inset" },
              },
            },
          },
        }),
        input: defineRecipe({
          variants: {
            size: { md: { minH: { base: "11", md: "10" }, textStyle: fieldTextSize } },
            variant: { outline: { borderColor: "border.control" } },
          },
        }),
        textarea: defineRecipe({
          variants: {
            size: { md: { textStyle: fieldTextSize } },
            variant: { outline: { borderColor: "border.control" } },
          },
        }),
      },
    },
  }),
);

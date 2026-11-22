import {
  createSystem,
  defaultConfig,
  defineConfig,
  defineRecipe,
  defineSlotRecipe,
} from "@chakra-ui/react";

const fieldTextSize = "md";

const color = (light: string, dark: string) => ({
  value: { base: light, _light: light, _dark: dark },
});

export const theme = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: { colorPalette: "teal", bg: "bg.canvas" },
      body: { bg: "bg.canvas", color: "fg", fontVariantNumeric: "tabular-nums" },
      "button:focus-visible": {
        outline: "2px solid",
        outlineColor: "focusRing",
        outlineOffset: "2px",
      },
      "*": { focusRingColor: "focusRing" },
      "a:focus-visible, summary:focus-visible, [tabindex]:focus-visible": {
        outline: "2px solid",
        outlineColor: "focusRing",
        outlineOffset: "2px",
      },
      "main a": { color: "teal.fg", overflowWrap: "anywhere" },
    },
    theme: {
      tokens: {
        radii: {
          sm: { value: "0.1875rem" },
          md: { value: "0.25rem" },
          lg: { value: "0.3125rem" },
          xl: { value: "0.375rem" },
          "2xl": { value: "0.5rem" },
        },
        fonts: {
          heading: { value: "system-ui, sans-serif" },
          body: { value: "system-ui, sans-serif" },
        },
      },
      semanticTokens: {
        colors: {
          bg: {
            DEFAULT: color("#ffffff", "#111214"),
            canvas: color("#f3f5f7", "#000000"),
            panel: color("#ffffff", "#111214"),
            chrome: color("#ffffff", "#0b0c0d"),
            inset: color("#eaedf1", "#1b1d20"),
          },
          fg: {
            DEFAULT: color("#161b23", "#f2f5f7"),
            muted: color("#4e5967", "#aebaca"),
          },
          border: {
            DEFAULT: color("#dce1e7", "#30343a"),
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
            fontWeight: "semibold",
            maxW: "full",
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          },
          variants: {
            variant: {
              outline: {
                color: "fg",
                borderColor: "border",
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

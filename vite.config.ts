import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["@chakra-ui/charts", "recharts"],
  },
  server: {
    proxy: {
      "/.well-known/oauth-": "http://127.0.0.1:8090",
      "/api": "http://127.0.0.1:8090",
    },
  },
});

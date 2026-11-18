import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AuthProvider } from "./features/auth/AuthProvider";
import { router } from "./app/router";

import { ColorModeProvider } from "./app/ColorModeControl";
import { theme } from "./app/theme";
import "./app/styles.scss";

const queryClient = new QueryClient();
const root = document.getElementById("root");

if (!root) {
  throw new Error("App root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ChakraProvider value={theme}>
      <ColorModeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </ColorModeProvider>
    </ChakraProvider>
  </StrictMode>,
);

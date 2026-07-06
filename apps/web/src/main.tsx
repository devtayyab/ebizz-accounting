import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./state/AuthContext";
import { CompanyProvider } from "./state/CompanyContext";
import { ConfirmProvider } from "./state/ConfirmContext";
import { ThemeProvider } from "./state/ThemeContext";
import { Toaster } from "./components/Toaster";
import { toast } from "./lib/toast";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  // Global toasts for every mutation: a per-mutation `meta.successMessage`
  // overrides the default, and any failure surfaces the API error message.
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const msg = (mutation.options.meta as { successMessage?: string } | undefined)?.successMessage;
      if (msg !== "") toast.success(msg ?? "Done");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    },
  }),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
        <AuthProvider>
          <CompanyProvider>
            <ConfirmProvider>
              <App />
              <Toaster />
            </ConfirmProvider>
          </CompanyProvider>
        </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

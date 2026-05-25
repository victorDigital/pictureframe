import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { App } from "./App.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <TooltipProvider delayDuration={150}>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </TooltipProvider>
  </ThemeProvider>,
);

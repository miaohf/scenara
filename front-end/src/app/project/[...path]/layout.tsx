"use client";

import { RequireAuth } from "@/providers/auth-provider";
import { AlertProvider } from "@/components/GlobalAlert";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { useProjectRoute } from "../use-project-route";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useProjectRoute();

  if (!projectId) return null;

  return (
    <RequireAuth>
      <ThemeProvider>
        <AlertProvider>
          <ProjectProvider projectId={projectId}>{children}</ProjectProvider>
        </AlertProvider>
      </ThemeProvider>
    </RequireAuth>
  );
}

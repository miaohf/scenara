"use client";

import { useParams } from "next/navigation";
import { RequireAuth } from "@/providers/auth-provider";
import { AlertProvider } from "@/components/GlobalAlert";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

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

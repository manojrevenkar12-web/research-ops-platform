import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AccessPage } from "../features/access/AccessPage";
import { ApprovalsPage } from "../features/approvals/ApprovalsPage";
import { CostsPage } from "../features/costs/CostsPage";
import { HandoverPage } from "../features/handover/HandoverPage";
import { ReportingPage } from "../features/reporting/ReportingPage";
import { ShotLogPage } from "../features/shotlog/ShotLogPage";
import { TargetsPage } from "../features/targets/TargetsPage";
import { TimesheetPage } from "../features/timesheet/TimesheetPage";
import { ApiError } from "../shared/lib/api";
import { EmptyState, ErrorState, Skeleton } from "../shared/ui";
import { Shell } from "./Shell";
import { SessionProvider, useSession } from "./session";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Refusals and missing rows will not change on a retry; network trouble may.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function Gate({ children }: { children: React.ReactNode }) {
  const { persona, loading, error, retry, me } = useSession();
  if (!persona)
    return (
      <EmptyState
        title="Who are you?"
        body="Choose a person in the sidebar to sign in. Each one has different roles, so each sees a different part of the record."
      />
    );
  if (loading) return <Skeleton label="Signing in" rows={6} />;
  if (error || !me) return <ErrorState error={error} onRetry={retry} />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Shell>
      <Gate>
        <Routes>
          <Route path="/" element={<Navigate to="/shotlog" replace />} />
          <Route path="/shotlog" element={<ShotLogPage />} />
          <Route path="/shotlog/:campaignId" element={<ShotLogPage />} />
          <Route path="/targets" element={<TargetsPage />} />
          <Route path="/time" element={<TimesheetPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/costs" element={<CostsPage />} />
          <Route path="/reporting" element={<ReportingPage />} />
          <Route path="/access" element={<AccessPage />} />
          <Route path="/handover" element={<HandoverPage />} />
          <Route
            path="*"
            element={<EmptyState title="Page not found" body="Use the sidebar to open one of the apps." />}
          />
        </Routes>
      </Gate>
    </Shell>
  );
}

export function App({ client = makeQueryClient() }: { client?: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <SessionProvider>
            <AppRoutes />
          </SessionProvider>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}

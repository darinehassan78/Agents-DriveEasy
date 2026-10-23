import { releaseExpiredHolds } from "./release-expired-holds";

// Scheduled jobs. Locally they run from the command line (`pnpm job <name>`);
// in the cloud a cron service will call the same functions, so only the
// trigger changes (SCHEDULER setting), not the job code.

export interface JobResult {
  message: string;
}

export const jobs: Record<string, () => Promise<JobResult>> = {
  "release-expired-holds": releaseExpiredHolds,
};

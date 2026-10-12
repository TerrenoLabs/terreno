# Tasks: Admin scripts via durable jobs

**IP:** [admin-scripts-durable-jobs.md](../implementationPlans/admin-scripts-durable-jobs.md)

- [x] **Task 1**: `admin/script` adapter (`defineAdminScriptJob`, payload parse, dual-write `BackgroundTask`)
- [x] **Task 2**: `AdminApp` enqueue/cancel when `JobsApp` is registered; in-process fallback
- [x] **Task 3**: example-backend worker + API share `defineAdminScriptJob(adminScripts)`
- [x] **Task 4**: Docs (how-to jobs, jobs reference, admin-backend scripts)
- [x] **Task 5**: Example GCP runtime selects `GcpCloudTasksRunner` and verifies callback OIDC
- [x] **Task 6**: CD supplies `JOBS_RUNNER=gcp-cloud-tasks` and per-PR callback URLs

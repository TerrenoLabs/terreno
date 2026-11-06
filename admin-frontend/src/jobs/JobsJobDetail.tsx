import {
  Accordion,
  Box,
  Button,
  Card,
  Heading,
  Link,
  MarkdownView,
  Spinner,
  Text,
  useToast,
} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback, useMemo} from "react";
import {AdminScreenPage} from "../AdminScreenPage";
import {JobsStatusBadge} from "./JobsStatusBadge";
import {
  canCancelJob,
  canRequeueJob,
  canRetryJob,
  formatJobTimestamp,
  type JobRow,
  jobRowId,
  unwrapJobRow,
} from "./jobPayload";
import {useJobsDashboardApi} from "./useJobsDashboardApi";

export interface JobsJobDetailProps {
  jobId: string;
  routeBase?: string;
}

const toJsonMarkdown = (value: unknown): string => {
  return `\`\`\`json\n${JSON.stringify(value ?? null, null, 2)}\n\`\`\``;
};

export const JobsJobDetail: React.FC<JobsJobDetailProps> = ({jobId, routeBase = "/admin"}) => {
  const toast = useToast();
  const {useCancelMutation, useDetailQuery, useRequeueMutation, useRetryMutation} =
    useJobsDashboardApi();
  const {data, error, isLoading} = useDetailQuery(jobId);
  const [retryJob, retryState] = useRetryMutation();
  const [requeueJob, requeueState] = useRequeueMutation();
  const [cancelJob, cancelState] = useCancelMutation();
  const job = unwrapJobRow(data);

  const openJob = useCallback(
    (id: string): void => {
      router.push(`${routeBase}/jobs/${id}` as Href);
    },
    [routeBase]
  );

  const handleRetry = useCallback(async (): Promise<void> => {
    try {
      const result = await retryJob(jobId).unwrap();
      const created = unwrapJobRow(result);
      if (!created) {
        throw new Error("Retry did not return a job");
      }
      openJob(jobRowId(created));
    } catch (retryError: unknown) {
      toast.catch(retryError, "Retry failed");
    }
  }, [jobId, openJob, retryJob, toast]);

  const handleRequeue = useCallback(async (): Promise<void> => {
    try {
      await requeueJob(jobId).unwrap();
      toast.success("Job requeued");
    } catch (requeueError: unknown) {
      toast.catch(requeueError, "Requeue failed");
    }
  }, [jobId, requeueJob, toast]);

  const handleCancel = useCallback(async (): Promise<void> => {
    try {
      await cancelJob(jobId).unwrap();
      toast.success("Job cancelled");
    } catch (cancelError: unknown) {
      toast.catch(cancelError, "Cancel failed");
    }
  }, [cancelJob, jobId, toast]);

  const payloadMarkdown = useMemo((): string => {
    if (!job) {
      return toJsonMarkdown(null);
    }
    if (job.payloadRedacted) {
      return "_Payload redacted for this job._";
    }
    if (job.payload === undefined) {
      return "_No payload available._";
    }
    return toJsonMarkdown(job.payload);
  }, [job]);

  return (
    <AdminScreenPage
      backHref={`${routeBase}/jobs`}
      color="transparent"
      maxWidth="100%"
      padding={0}
      scroll
      title="Job detail"
    >
      <Box gap={4} padding={4} testID="jobs-job-detail">
        {isLoading ? (
          <Box alignItems="center" padding={6} testID="jobs-detail-loading">
            <Spinner />
          </Box>
        ) : null}
        {error ? (
          <Text color="error" testID="jobs-detail-error">
            Failed to load job.
          </Text>
        ) : null}
        {!isLoading && !error && !job ? (
          <Text testID="jobs-detail-empty">Job not found.</Text>
        ) : null}
        {job ? (
          <JobBody
            cancelLoading={cancelState.isLoading}
            handleCancel={handleCancel}
            handleRequeue={handleRequeue}
            handleRetry={handleRetry}
            job={job}
            openJob={openJob}
            payloadMarkdown={payloadMarkdown}
            requeueLoading={requeueState.isLoading}
            retryLoading={retryState.isLoading}
          />
        ) : null}
      </Box>
    </AdminScreenPage>
  );
};

interface JobBodyProps {
  cancelLoading: boolean;
  handleCancel: () => Promise<void>;
  handleRequeue: () => Promise<void>;
  handleRetry: () => Promise<void>;
  job: JobRow;
  openJob: (id: string) => void;
  payloadMarkdown: string;
  requeueLoading: boolean;
  retryLoading: boolean;
}

const JobBody: React.FC<JobBodyProps> = ({
  cancelLoading,
  handleCancel,
  handleRequeue,
  handleRetry,
  job,
  openJob,
  payloadMarkdown,
  requeueLoading,
  retryLoading,
}) => {
  const retryAllowed = canRetryJob(job);
  const requeueAllowed = canRequeueJob(job);
  const cancelAllowed = canCancelJob(job);

  return (
    <>
      <Box direction="row" gap={3} justifyContent="between" wrap>
        <Box gap={2}>
          <Box alignItems="center" direction="row" gap={2}>
            <Heading size="md">{job.name}</Heading>
            <JobsStatusBadge status={job.status} testID="jobs-detail-status" />
          </Box>
          <Text color="secondaryDark" size="sm">
            {`Created ${formatJobTimestamp({empty: "—", value: job.created})}`}
          </Text>
          <Text color="secondaryDark" size="sm">
            {`Run at ${formatJobTimestamp({empty: "—", value: job.runAt})}`}
          </Text>
          <Text color="secondaryDark" size="sm">
            {`Updated ${formatJobTimestamp({empty: "—", value: job.updated})}`}
          </Text>
        </Box>
        <Box direction="row" gap={2} wrap>
          <Button
            disabled={!retryAllowed}
            loading={retryLoading}
            onClick={handleRetry}
            testID="jobs-detail-retry"
            text="Retry"
            variant="primary"
            withConfirmation={retryAllowed}
          />
          <Button
            disabled={!requeueAllowed}
            loading={requeueLoading}
            onClick={handleRequeue}
            testID="jobs-detail-requeue"
            text="Requeue"
            variant="secondary"
            withConfirmation={requeueAllowed}
          />
          <Button
            disabled={!cancelAllowed}
            loading={cancelLoading}
            onClick={handleCancel}
            testID="jobs-detail-cancel"
            text="Cancel"
            variant="destructive"
            withConfirmation={cancelAllowed}
          />
        </Box>
      </Box>
      {job.lastError ? (
        <Card padding={3} testID="jobs-detail-error-card">
          <Heading size="sm">Last error</Heading>
          <Text color="error">{job.lastError}</Text>
        </Card>
      ) : null}
      {job.lockedAt || job.lockedBy ? (
        <Card padding={3} testID="jobs-detail-lock-card">
          <Heading size="sm">Lock</Heading>
          <Text size="sm">{`Worker ${job.lockedBy ?? "unknown"}`}</Text>
          <Text color="secondaryDark" size="sm">
            {`Locked ${formatJobTimestamp({empty: "—", value: job.lockedAt})}`}
          </Text>
        </Card>
      ) : null}
      <Box direction="row" gap={3} wrap>
        {job.retriedFromId ? (
          <Link
            onClick={() => openJob(job.retriedFromId ?? "")}
            testID="jobs-detail-retried-from"
            text="Original job"
          />
        ) : null}
        {job.retriedById ? (
          <Link
            onClick={() => openJob(job.retriedById ?? "")}
            testID="jobs-detail-retried-by"
            text="Retry row"
          />
        ) : null}
      </Box>
      <Card padding={3}>
        <Heading size="sm">Attempts</Heading>
        {(job.attempts ?? []).length === 0 ? (
          <Text color="secondaryDark">No attempts recorded.</Text>
        ) : (
          (job.attempts ?? []).map((attempt, index) => (
            <Box
              gap={1}
              key={`${attempt.at ?? "attempt"}-${index}`}
              padding={2}
              testID={`jobs-attempt-${index}`}
            >
              <Text bold size="sm">
                {formatJobTimestamp({empty: "—", value: attempt.at})}
              </Text>
              {attempt.errorClass ? <Text size="sm">{attempt.errorClass}</Text> : null}
              {attempt.error ? (
                <Text color="error" size="sm">
                  {attempt.error}
                </Text>
              ) : null}
            </Box>
          ))
        )}
      </Card>
      <Accordion isCollapsed testID="jobs-detail-payload" title="Payload">
        <MarkdownView>{payloadMarkdown}</MarkdownView>
      </Accordion>
    </>
  );
};

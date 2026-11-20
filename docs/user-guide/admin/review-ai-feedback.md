---
title: Find what users said about AI answers
area: admin
audience: admin
platforms: [web]
questions:
  - How do I see which AI answers users gave a thumbs down?
  - Where do I read the comments users left on AI answers?
  - Why is there a feedback item in the review queue?
screens:
  - "admin-frontend/src/widgets/aiObservability/traces/AiTracesListView.tsx"
  - "admin-frontend/src/widgets/aiObservability/traces/AiTraceDetailView.tsx"
  - "admin-frontend/src/widgets/aiObservability/review/AiReviewQueueView.tsx"
added: ai-user-feedback
---

# Find what users said about AI answers

## What it does

When people rate an AI answer, leave a comment on it, or keep, dismiss, or copy it, that
feedback is saved with the answer. You can list the answers by that feedback and read each
comment. Answers that get a thumbs down can also be queued for review automatically.

## How to use it

1. In the admin panel, open **AI Observability** and choose **Traces**.
2. Open **More filters**.
3. Set **Thumbs** to **Down** to list answers people disliked, or **Up** for the ones they liked.
   Use **Signal** to list answers people kept (**Accepted**), dismissed, copied, edited, or
   regenerated, and turn on **Has comment** to list only answers with a written comment.
4. Apply the filters, then select a row to open the answer.
5. Under **Scores**, each score shows who gave it: **User** for a rating or comment, **Signal**
   for something the person did, and **Human**, **Judge**, or **Code** for reviews. A comment
   shows under its rating. On an answer marked sensitive, open **Comment (sensitive)** to read it.

When your app is set up to queue thumbs-down answers, each one appears in **Review queue** under
**Pending**, marked **From user feedback**. Choose **Review oldest pending** to work through them.

## Intended use

Use this to find weak AI answers and learn why people disliked them, then review them or add
them to a dataset. Comments are written by people and may contain personal details, so treat
them like the answers themselves. A thumbs up does not queue anything for review.

## Related

- [Browse and edit records in the admin panel](manage-records.md)

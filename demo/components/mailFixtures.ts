import {DateTime} from "luxon";

export interface MailMessageFixture {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
}

const SENDERS = [
  "Avery Chen",
  "Jordan Patel",
  "Sam Rivera",
  "Morgan Lee",
  "Riley Okafor",
  "Casey Novak",
];

const SUBJECTS = [
  "Quarterly planning notes",
  "Design review moved to Thursday",
  "Lunch order for the offsite",
  "Release checklist for 2.4",
  "Feedback on the onboarding flow",
  "Invoice for September",
  "Welcome our new teammate",
  "Draft of the launch post",
  "Retro action items",
  "Office closed on Monday",
];

// A fixed anchor keeps fixture dates stable between renders and screenshots.
const ANCHOR = DateTime.fromISO("2026-10-20T09:00:00Z");

export const MAIL_MESSAGES: MailMessageFixture[] = Array.from({length: 30}, (_unused, index) => {
  const subject = SUBJECTS[index % SUBJECTS.length] ?? "Message";
  const sender = SENDERS[index % SENDERS.length] ?? "Sender";
  const preview = `Hi team, a quick note about ${subject.toLowerCase()}.`;
  return {
    body: `${preview}\n\nThis is message ${index + 1} of the demo inbox. Open another message from the list to replace it; on a phone, go back to return to the list.\n\nThanks,\n${sender}`,
    id: String(index + 1),
    preview,
    receivedAt: ANCHOR.minus({hours: index * 5}).toISO() ?? "",
    sender,
    subject,
  };
});

export const findMailMessage = (id: string | undefined): MailMessageFixture | undefined => {
  return MAIL_MESSAGES.find((message) => message.id === id);
};

export const formatReceivedAt = (receivedAt: string): string => {
  return DateTime.fromISO(receivedAt).toFormat("LLL d, h:mm a");
};

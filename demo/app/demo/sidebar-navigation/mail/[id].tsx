import {MailMessage} from "@components/MailMessage";
import {mailStaticParams} from "@components/mailFixtures";
import type {FC} from "react";

// Static export writes one HTML file per fixture, so /demo/sidebar-navigation/mail/2 is a real page.
export const generateStaticParams = (): {id: string}[] => mailStaticParams();

const MailMessageScreen: FC = () => <MailMessage />;

export default MailMessageScreen;

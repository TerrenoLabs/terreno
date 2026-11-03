import {MailLayout} from "@components/MailLayout";
import type {FC} from "react";

// A deep link to a message on a phone still has the inbox to go back to.
export const unstable_settings = {initialRouteName: "index"};

const MailRouteLayout: FC = () => <MailLayout indexHref="/demo/list-detail" />;

export default MailRouteLayout;

import {MailList} from "@components/MailList";
import {MailEmptyState} from "@components/MailMessage";
import {ListDetailLayout} from "@terreno/ui";
import type {FC} from "react";

/**
 * The demo inbox as a ListDetailLayout. `indexHref` is the route group that mounts it, so the
 * same inbox runs standalone and inside SidebarNavigation.
 */
export const MailLayout: FC<{indexHref: string}> = ({indexHref}) => (
  <ListDetailLayout
    detailHref={(id) => `${indexHref}/${id}`}
    emptyDetail={<MailEmptyState />}
    indexHref={indexHref}
    list={<MailList />}
    screenOptions={{title: "Inbox"}}
  />
);

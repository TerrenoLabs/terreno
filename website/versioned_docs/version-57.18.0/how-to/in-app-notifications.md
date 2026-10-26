# In-app notifications

Add an owner-scoped inbox, channel preferences, and optional comms fan-out to a Terreno app.

## 1. Register `NotificationsApp`

On your `TerrenoApp`, register the plugin and pass your user model. When you already use
`@terreno/comms`, pass `getComms` so `notify()` can fan out to mail, SMS, and push.

```typescript
import {NotificationsApp, TerrenoApp} from "@terreno/api";
import {CommsApp, getCommsService} from "@terreno/comms";

new TerrenoApp({userModel: User})
  .register(
    new NotificationsApp({
      getComms: getCommsService,
      retainDays: 0,
      userModel: User,
    })
  )
  .register(new CommsApp({/* providers */}))
  .start();
```

`retainDays` defaults to `0` (keep all rows). Set a positive number to tombstone rows older
than that many days (no Mongo TTL index).

## 2. Wire comms preferences

Export `notificationsBeforeSend` from `@terreno/api` and compose it into `CommsApp`
`beforeSend`. It cancels outbound mail, SMS, or push when the user turned that channel off.
The `verification` channel is never cancelled.

```typescript
import {notificationsBeforeSend} from "@terreno/api";

new CommsApp({
  beforeSend: async (context) => {
    const pref = await notificationsBeforeSend({
      channel: context.channel,
      userId: context.userId,
    });
    if (pref?.cancel) {
      return {cancel: true};
    }
    return undefined;
  },
  mail: mailProvider,
});
```

## 3. Send notifications from server code

Only the service inserts inbox rows (HTTP create is disabled).

```typescript
import {getNotificationService} from "@terreno/api";

await getNotificationService().notify({
  userId: String(user._id),
  title: "Todo completed",
  body: "Your task is done.",
  href: "/todos",
  kind: "todo",
});
```

Fan-out order: inbox write (when `inapp` is on), then mail, SMS, and push when each
preference is on and a destination exists. Missing email, phone, or push tokens skip that
channel without failing `notify()`. A provider rejection on one channel is logged and
does not skip later channels.

## 4. Sync collections on the client

Regenerate syncdb hooks (not RTK CRUD) for `notifications` and `notification-preferences`:

```bash
cd example-frontend
bun run sync-sdk
```

Add the generated `SYNC_COLLECTIONS` to `createSyncDb`. Use `useQuery` / `useMutate` (or
generated hooks) for list, mark-read (`readAt`), and dismiss (delete).

## 5. Presentational UI

Import the bell, inbox, and right-side drawer from `@terreno/ui`. The components take
data and callbacks only — wire them to syncdb in your screen:

```typescript
import {NotificationBell, NotificationInbox, SideDrawer} from "@terreno/ui";

<NotificationBell unreadCount={unreadCount} onPress={() => setOpen((value) => !value)} />
<SideDrawer
  isOpen={open}
  onClose={() => setOpen(false)}
  position="right"
  renderContent={() => (
    <NotificationInbox
      items={items}
      onMarkRead={(item) => patch({id: item.id, data: {readAt: DateTime.now().toISO()}})}
      onMarkUnread={(item) => patch({id: item.id, data: {readAt: null}})}
      onDismiss={(item) => remove({id: item.id})}
      onOpen={(item) => item.href?.startsWith("/") && router.push(item.href)}
    />
  )}
>
  {screen}
</SideDrawer>
```

Customize the bell without reimplementing its tap target or unread accessibility label:

```typescript
<NotificationBell
  unreadCount={unreadCount}
  onPress={() => setOpen((value) => !value)}
  renderIcon={({testID}) => <BrandBell testID={testID} />}
  renderBadge={({testID, unreadCount}) => (
    <BrandBubble count={unreadCount} testID={testID} />
  )}
/>
```

Treat dismissed rows as archived, not deleted. Dismiss PATCHes `archivedAt` through
syncdb so the row stays in the owner snapshot with its payload. The active inbox
filters `archivedAt` out; the full history page uses the same `useQuery("notifications")`
and splits on `archivedAt`. Retention (`retainDays`) still tombstones old rows with
`deleted: true`; those drop out of history after compaction. Map `archivedAt` (or a
legacy `deleted` tombstone still in the local store) to `NotificationInboxItem.archived`.
Archived rows remain readable but `NotificationInbox` hides their dismiss and read-state
actions.

See `example-frontend/components/NotificationCenter.tsx` and
`example-frontend/app/notifications.tsx` for the drawer and complete history page.
These components are not in the `@terreno/ui` component demo.

The example todo router also demonstrates lifecycle-generated activity notifications:
`postCreate` reports added todos, `postUpdate` reports a false-to-true `completed`
transition, and `postDelete` reports deletion.

## Reference

- API shapes: [In-app notifications](../reference/api.md#in-app-notifications)
- UI props: [Notification components](../reference/ui.md#notification-components)
- Comms hook: [beforeSend composition](../reference/comms.md#notification-preferences-hook)

> **stopChangeStreamWatcher**(): `Promise`\<`void`\>

Stop the change stream watcher and end Task 9.16's restart supervision (a pending
reopen is cancelled, and terminal events from the closing stream are ignored).

## Returns

`Promise`\<`void`\>

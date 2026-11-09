Configuration for the MongoDB change stream watcher.

## Properties

### additionalCollections?

> `optional` **additionalCollections?**: `string`[]

Non-modelRouter collections to watch (emits raw events)

***

### batchSize?

> `optional` **batchSize?**: `number`

Change stream batch size (default: 50)

***

### fullDocument?

> `optional` **fullDocument?**: `"updateLookup"` \| `"whenAvailable"`

Full document mode (default: "updateLookup")

***

### ignoredCollections?

> `optional` **ignoredCollections?**: `string`[]

Collections to never watch (e.g. "socketio", "sessions")

***

### ignoredOperations?

> `optional` **ignoredOperations?**: `string`[]

Operation types to ignore

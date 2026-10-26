> **ApiErrorClassification** = `"rateLimited"` \| `"unauthorized"` \| `"notFound"` \| `"validation"` \| `"server"` \| `"network"` \| `"unknown"`

Machine-readable classification of an external API failure, used to drive retry
policies and consistent logging across API clients.

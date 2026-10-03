import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import {
  HARNESS_CONVERSATION_STATUSES,
  type HarnessConversationDocument,
  type HarnessConversationModel,
} from "../../types/harness";

const modelRefSchema = {
  modelId: {description: "Provider model id, for example claude-sonnet-5-5", type: String},
  provider: {description: "Provider name the models resolver understands", type: String},
};

const harnessConversationSchema = new mongoose.Schema<
  HarnessConversationDocument,
  HarnessConversationModel
>(
  {
    activeTurnTaskId: {
      description: "Turn task running on this conversation while it is busy",
      ref: "HarnessTask",
      type: mongoose.Schema.Types.ObjectId,
    },
    agent: {
      extensions: {
        default: [],
        description: "Extension names applied to this conversation's requests",
        type: [String],
      },
      fallbackModels: {
        default: [],
        description: "Models tried in order after the primary model's retries run out",
        type: [new mongoose.Schema(modelRefSchema, {_id: false, strict: "throw"})],
      },
      instructions: {description: "System prompt sent with every model request", type: String},
      maxSteps: {description: "Model requests one turn may make", type: Number},
      model: modelRefSchema,
      name: {description: "Registered agent definition name", required: true, type: String},
      tools: {
        default: [],
        description: "Tool names the model may call in this conversation",
        type: [String],
      },
    },
    ownership: {
      id: {
        description: "Owning task id for a subagent conversation; empty for root conversations",
        ref: "HarnessTask",
        type: mongoose.Schema.Types.ObjectId,
      },
      kind: {
        default: "root",
        description: "What owns this conversation: nothing (root) or a task (subagent)",
        enum: ["root", "task"],
        type: String,
      },
    },
    queued: {
      default: [],
      description: "Submissions waiting for the current turn (whenBusy: queue, Task 1.9)",
      type: [
        new mongoose.Schema(
          {
            content: {
              description: "Submitted user content",
              type: mongoose.Schema.Types.Mixed,
            },
            requestId: {description: "Caller idempotency key of the submission", type: String},
            submittedAt: {description: "When the submission arrived", type: Date},
          },
          {_id: false, strict: "throw"}
        ),
      ],
    },
    seq: {
      default: 0,
      description: "Highest message sequence number handed out; messages count up from 1",
      type: Number,
    },
    status: {
      default: HARNESS_CONVERSATION_STATUSES.idle,
      description: "idle, or busy while a turn task runs",
      enum: Object.values(HARNESS_CONVERSATION_STATUSES),
      type: String,
    },
    userId: {
      description: "User the conversation belongs to; turn tasks run as this user",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

harnessConversationSchema.plugin(createdUpdatedPlugin);
harnessConversationSchema.plugin(isDeletedPlugin);
harnessConversationSchema.plugin(findOneOrNone);
harnessConversationSchema.plugin(findExactlyOne);
harnessConversationSchema.index({created: -1, userId: 1});
harnessConversationSchema.index({"ownership.id": 1, "ownership.kind": 1});

export const registerHarnessConversation = (): HarnessConversationModel => {
  if (mongoose.models.HarnessConversation) {
    return mongoose.models.HarnessConversation as HarnessConversationModel;
  }
  return mongoose.model<HarnessConversationDocument, HarnessConversationModel>(
    "HarnessConversation",
    harnessConversationSchema
  );
};

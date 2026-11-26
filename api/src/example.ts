import express from "express";
import mongoose, {model, Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";

import {type ModelRouterOptions, modelRouter} from "./api";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "./auth";
import {logger} from "./logger";
import {Permissions} from "./permissions";
import {
  baseUserPlugin,
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  isDeletedPlugin,
} from "./plugins";
import {TerrenoApp} from "./terrenoApp";

mongoose
  .connect("mongodb://localhost:27017/example")
  .then(() => {
    logger.debug("Connected to mongo");
  })
  .catch((err) => {
    logger.error(`Error connecting to mongo ${err}`);
  });

interface User {
  admin: boolean;
  username: string;
}

interface Food {
  name: string;
  calories: number;
  created: Date;
  ownerId: mongoose.Types.ObjectId | User;
  hidden?: boolean;
}

const userSchema = new Schema<User>(
  {
    admin: {default: false, description: "Whether the user has admin privileges", type: Boolean},
    username: {description: "The user's username", type: String},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

userSchema.plugin(passportLocalMongoose as unknown as Parameters<typeof userSchema.plugin>[0], {
  usernameField: "email",
});
userSchema.plugin(createdUpdatedPlugin);
userSchema.plugin(isDeletedPlugin);
userSchema.plugin(findOneOrNone);
userSchema.plugin(findExactlyOne);
userSchema.plugin(baseUserPlugin);
const UserModel = model<User>("User", userSchema);

const schema = new Schema<Food>(
  {
    calories: {description: "Number of calories in the food", type: Number},
    created: {description: "When this food was created", type: Date},
    hidden: {
      default: false,
      description: "Whether this food is hidden from listings",
      type: Boolean,
    },
    name: {description: "The name of the food", type: String},
    ownerId: {description: "The user who owns this food entry", ref: "User", type: "ObjectId"},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

schema.plugin(createdUpdatedPlugin);
schema.plugin(isDeletedPlugin);
schema.plugin(findOneOrNone);
schema.plugin(findExactlyOne);

const FoodModel = model<Food>("Food", schema);

const getBaseServer = () => {
  const app = express();

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    // intercepts OPTIONS method
    if (req.method === "OPTIONS") {
      res.send(200);
    } else {
      next();
    }
  });
  app.use(express.json());
  setupAuth(app, UserModel as unknown as UserMongooseModel);
  addAuthRoutes(app, UserModel as unknown as UserMongooseModel);

  const addRoutes = (
    router: express.Router,
    options?: Partial<ModelRouterOptions<unknown>>
  ): void => {
    router.use(
      "/food",
      modelRouter(FoodModel, {
        ...(options as Partial<ModelRouterOptions<Food>>),
        openApiOverwrite: {
          get: {responses: {200: {description: "Get all the food"}}},
        },
        permissions: {
          create: [Permissions.IsAuthenticated],
          delete: [Permissions.IsAdmin],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsOwner],
        },
        queryFields: ["name", "calories", "created", "ownerId", "hidden"],
      })
    );
  };

  return new TerrenoApp({
    configureApp: addRoutes,
    loggingOptions: {
      level: "debug",
    },
    userModel: UserModel,
  }).build();
};
getBaseServer();

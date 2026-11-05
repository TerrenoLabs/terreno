import mongoose, {type Model, model, Schema, type StringSchemaDefinition} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";

import type {UserModel as AuthUserModel} from "../auth";
import {
  createdUpdatedPlugin,
  DateOnly,
  emailVerificationPlugin,
  isDisabledPlugin,
} from "../plugins";

export interface User {
  _id: mongoose.Types.ObjectId;
  id: string;
  admin: boolean;
  name?: string;
  username: string;
  email: string;
  age?: number;
  disabled?: boolean;
  organizationIds?: string[];
  roles?: string[];
  tokenEpoch?: number;
  emailVerified?: boolean;
}

export interface SuperUser extends User {
  superTitle: string;
}

export interface StaffUser extends User {
  department: string;
}

export interface FoodCategory {
  _id?: string;
  addendums?: FoodCategoryAddendum[];
  name: string;
  show: boolean;
  created: Date;
  updated: Date;
}

interface FoodCategoryAddendum {
  text: string;
}

export interface Food {
  _id: string;
  name: string;
  calories: number;
  created: Date;
  ownerId: mongoose.Types.ObjectId | User;
  hidden?: boolean;
  source: {
    name: string;
    href?: string;
    dateAdded?: string;
  };
  tags: string[];
  eatenBy: Array<mongoose.Types.ObjectId | User>;
  lastEatenWith: {[name: string]: Date};
  categories: FoodCategory[];
  expiration: string;
  likesIds: {userId: mongoose.Types.ObjectId | string; likes: boolean}[];
}

export interface RequiredField {
  name: string;
  about?: string;
}

const userSchema = new Schema<User>({
  admin: {default: false, description: "Whether the user has admin privileges", type: Boolean},
  age: {description: "The user's age", type: Number},
  name: {description: "The user's display name", type: String},
  organizationIds: {
    default: [],
    description: "Organization memberships",
    type: [String],
  },
  roles: {
    default: [],
    description: "RBAC role names assigned to this user",
    type: [String],
  },
  tokenEpoch: {
    default: 0,
    description: "Incremented on password reset to invalidate outstanding refresh tokens",
    type: Number,
  },
  username: {description: "The user's username", type: String},
});

userSchema.plugin(
  passportLocalMongoose as unknown as (schema: Schema, options?: Record<string, unknown>) => void,
  {
    attemptsField: "attempts",
    interval: 1,
    limitAttempts: true,
    maxAttempts: 3,
    // Test-only schema: maxInterval 0 caps calculatedInterval at 0 so AttemptTooSoon
    // never preempts maxAttempts lockout under rapid supertest logins.
    maxInterval: 0,
    usernameCaseInsensitive: true,
    usernameField: "email",
  }
);
userSchema.plugin(createdUpdatedPlugin);
userSchema.plugin(isDisabledPlugin);
userSchema.plugin(emailVerificationPlugin);
userSchema.methods.postCreate = async function (body: {age?: number}) {
  this.age = body.age;
  return this.save();
};

export const UserModel = model<User>("User", userSchema);

/**
 * `UserModel` typed as the auth `UserModel` for `setupAuth`, `TerrenoApp({userModel})`, and
 * friends. passport-local-mongoose adds the statics at runtime but ships no types, and the auth
 * `User._id` uses mongoose's schema `ObjectId` type, so the models are not structurally related.
 */
export const authUserModel = UserModel as unknown as AuthUserModel;

const superUserSchema = new Schema<SuperUser>({
  superTitle: {description: "The super user's title", required: true, type: String},
});
export const SuperUserModel = UserModel.discriminator("SuperUser", superUserSchema);

const staffUserSchema = new Schema<StaffUser>({
  department: {
    description: "The department the staff member belongs to",
    required: true,
    type: String,
  },
});
export const StaffUserModel = UserModel.discriminator("Staff", staffUserSchema);

const foodCategorySchema = new Schema<FoodCategory>(
  {
    addendums: {
      description: "Extra details about this food category",
      type: [
        new Schema<FoodCategoryAddendum>({
          text: {description: "The additional category detail", type: String},
        }),
      ],
    },
    name: {description: "The name of the food category", type: String},
    show: {description: "Whether this category is visible", type: Boolean},
  },
  {timestamps: {createdAt: "created", updatedAt: "updated"}}
);

interface Likes {
  likes: boolean;
  userId: mongoose.Types.ObjectId;
}

const likesSchema = new Schema<Likes>({
  likes: {description: "Whether the user liked the item", type: Boolean},
  userId: {description: "The user who liked the item", ref: "User", type: "ObjectId"},
});

const foodSchema = new Schema<Food>(
  {
    calories: {description: "Number of calories in the food", type: Number},
    categories: {description: "Categories this food belongs to", type: [foodCategorySchema]},
    created: {description: "When this food was created", type: Date},
    eatenBy: [
      {
        description: "Users who have eaten this food",
        ref: "User",
        required: true,
        type: Schema.Types.ObjectId,
      },
    ],
    expiration: {
      description: "Expiration date of the food",
      // DateOnly is a custom SchemaType registered on Schema.Types; it stores an ISO date string.
      type: DateOnly as unknown as StringSchemaDefinition,
    },
    hidden: {
      default: false,
      description: "Whether this food is hidden from listings",
      type: Boolean,
    },
    lastEatenWith: {
      description: "Map of user names to dates they last ate this food with",
      of: Date,
      type: Map,
    },
    likesIds: {description: "User likes for this food", required: true, type: [likesSchema]},
    name: {description: "The name of the food", type: String},
    ownerId: {description: "The user who owns this food entry", ref: "User", type: "ObjectId"},
    source: {
      dateAdded: {description: "When the source was added", type: String},
      href: {description: "URL of the source", type: String},
      name: {description: "Name of the source", type: String},
    },
    tags: {description: "Tags associated with this food", type: [String]},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

foodSchema.virtual("description").get(function (this: Food) {
  return `${this.name} has ${this.calories} calories`;
});

export const FoodModel: Model<Food> = model<Food>("Food", foodSchema);

const requiredSchema = new Schema<RequiredField>({
  about: {description: "Information about the item", type: String},
  name: {description: "The name of the item", required: true, type: String},
});
export const RequiredModel = model<RequiredField>("Required", requiredSchema);

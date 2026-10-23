/**
 * Consent status per form for one user: the "considered signed" contract apps build on.
 * A provisional signature counts as consented until the user answers the form themselves.
 */

import mongoose from "mongoose";

import type {User} from "./auth";
import {APIError} from "./errors";
import {ConsentForm} from "./models/consentForm";
import {ConsentResponse} from "./models/consentResponse";
import {findOneOrNoneFor} from "./plugins";
import type {ConsentFormDocument} from "./types/consentForm";
import type {ConsentResponseDocument} from "./types/consentResponse";
import {isValidObjectId} from "./utils";

export type ResolveConsentForms = (
  user: User,
  forms: ConsentFormDocument[]
) => ConsentFormDocument[] | Promise<ConsentFormDocument[]>;

export type ConsentStatus = "pending" | "provisional" | "signed" | "declined";

/** A consent form as serialized to clients (`toJSON` with maps flattened). */
export interface ConsentStatusForm {
  _id: string;
  id: string;
  title: string;
  slug: string;
  version: number;
  type: string;
  content: Record<string, string>;
  [field: string]: unknown;
}

export interface ConsentStatusSigner {
  id: string;
  name?: string;
  email?: string;
}

export interface ConsentStatusProvisional {
  responseId: string;
  signedAt: Date;
  signedBy: ConsentStatusSigner | null;
  note?: string;
}

export interface ConsentStatusRow {
  form: ConsentStatusForm;
  status: ConsentStatus;
  isConsented: boolean;
  respondedAt?: Date;
  /** The latest provisional signature for the current version, whatever the status. */
  provisional?: ConsentStatusProvisional;
}

/** Fields returned for the provisional signer on provisional consent responses. */
export const provisionalSignerPopulate = {path: "provisionalSignedBy", select: "name email"};

/** Load the consent forms that apply to a user: active forms, narrowed by the app's resolver. */
export const resolveFormsForUser = async (
  user: User,
  resolveConsentForms?: ResolveConsentForms
): Promise<{activeForms: ConsentFormDocument[]; resolvedForms: ConsentFormDocument[]}> => {
  const activeForms = await ConsentForm.find({active: true}).sort({order: 1});
  if (!resolveConsentForms) {
    return {activeForms, resolvedForms: activeForms};
  }
  const resolvedForms = await resolveConsentForms(user, activeForms);
  return {activeForms, resolvedForms};
};

/** Load a user by id, or throw 400 for a malformed id and 404 for an unknown one. */
export const loadConsentTargetUser = async (userId: string): Promise<User> => {
  if (!isValidObjectId(userId)) {
    throw new APIError({status: 400, title: "userId is invalid"});
  }
  const user = await findOneOrNoneFor(mongoose.model("User"), {_id: userId});
  if (!user) {
    throw new APIError({status: 404, title: "User not found"});
  }
  return user as unknown as User;
};

const toSigner = (value: unknown): ConsentStatusSigner | null => {
  if (!value || typeof value !== "object" || !("_id" in value)) {
    return null;
  }
  const signer = value as {_id: mongoose.Types.ObjectId; email?: string; name?: string};
  return {email: signer.email, id: signer._id.toString(), name: signer.name};
};

const statusForResponses = (
  responses: ConsentResponseDocument[]
): Pick<ConsentStatusRow, "isConsented" | "provisional" | "respondedAt" | "status"> => {
  // Responses arrive newest first, so the first match is the latest.
  const own = responses.find((response) => !response.provisional);
  const provisional = responses.find((response) => response.provisional);
  const provisionalSummary: ConsentStatusProvisional | undefined = provisional
    ? {
        note: provisional.provisionalNote,
        responseId: provisional._id.toString(),
        signedAt: provisional.agreedAt,
        signedBy: toSigner(provisional.provisionalSignedBy),
      }
    : undefined;

  if (own) {
    return {
      isConsented: own.agreed,
      provisional: provisionalSummary,
      respondedAt: own.agreedAt,
      status: own.agreed ? "signed" : "declined",
    };
  }
  if (provisional) {
    return {
      isConsented: true,
      provisional: provisionalSummary,
      respondedAt: provisional.agreedAt,
      status: "provisional",
    };
  }
  return {isConsented: false, status: "pending"};
};

/**
 * Consent status for every active form that applies to the user, in form order. Only
 * responses to each form's current version count. The user's own latest response decides
 * (`signed` or `declined`); otherwise a provisional signature makes it `provisional`, which
 * counts as consented; otherwise `pending`.
 */
export const getConsentStatuses = async ({
  userId,
  resolveConsentForms,
}: {
  userId: string;
  resolveConsentForms?: ResolveConsentForms;
}): Promise<ConsentStatusRow[]> => {
  const user = await loadConsentTargetUser(userId);
  const {resolvedForms} = await resolveFormsForUser(user, resolveConsentForms);

  const responses = await ConsentResponse.find({
    consentFormId: {$in: resolvedForms.map((form) => form._id)},
    userId,
  })
    .sort({agreedAt: -1})
    .populate(provisionalSignerPopulate);

  return resolvedForms.map((form) => {
    const current = responses.filter(
      (response) =>
        response.consentFormId.toString() === form._id.toString() &&
        response.formVersionSnapshot === form.version
    );
    const row: ConsentStatusRow = {
      // A JSON round trip gives the same shape clients receive: string ids, flattened maps.
      form: JSON.parse(JSON.stringify(form)) as ConsentStatusForm,
      ...statusForResponses(current),
    };
    if (!row.provisional) {
      delete row.provisional;
    }
    if (!row.respondedAt) {
      delete row.respondedAt;
    }
    return row;
  });
};

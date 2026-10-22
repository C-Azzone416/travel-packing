"use server";

// Server actions for the Saved lists pages (#167). Each goes through the owner-gated service: the owner comes from the
// session, a list id from the URL is only a lookup key (another owner's list is NOT_FOUND), and refusals come back as
// data (a code, a reason such as NAME_TAKEN or EXISTS, the invalid field names) so the screen can say what is wrong.

import { redirect } from "next/navigation";
import { ACCESS_DENIED_PATH, SIGN_IN_PATH } from "@/server/auth/proxy-handler";
import type { ErrorCode, Result } from "@/server/data/result";
import { getDataContext } from "@/server/data/runtime";
import * as service from "@/server/data/service";
import type { SavedListDetail, SavedListSummary } from "@/server/data/service";

export type SavedListFailure = { ok: false; code: ErrorCode; reason?: string; fields?: string[] };
export type SavedListsResult = { ok: true; lists: SavedListSummary[] } | SavedListFailure;
export type SavedListResult = { ok: true; list: SavedListDetail } | SavedListFailure;
export type SavedListDeleteResult = { ok: true; id: string } | SavedListFailure;

export interface NewSavedListItem {
  name: string;
  category: string;
  qty: number;
}

async function call<T>(
  work: (context: NonNullable<Awaited<ReturnType<typeof getDataContext>>>) => Promise<Result<T>>,
): Promise<{ ok: true; data: T } | SavedListFailure> {
  const context = await getDataContext();
  if (!context) return { ok: false, code: "INTERNAL" };
  const result = await work(context);
  if (result.ok) return { ok: true, data: result.data };
  if (result.error.code === "UNAUTHENTICATED") redirect(SIGN_IN_PATH);
  if (result.error.code === "FORBIDDEN") redirect(ACCESS_DENIED_PATH);
  const { code, reason, fields } = result.error;
  return { ok: false, code, ...(reason ? { reason } : {}), ...(fields ? { fields } : {}) };
}

async function asList(pending: ReturnType<typeof call<SavedListDetail>>): Promise<SavedListResult> {
  const result = await pending;
  return result.ok ? { ok: true, list: result.data } : result;
}

export async function listSavedListsAction(): Promise<SavedListsResult> {
  const result = await call((context) => service.listSavedListSummaries(context));
  return result.ok ? { ok: true, lists: result.data } : result;
}

export async function getSavedListAction(listId: string): Promise<SavedListResult> {
  return asList(call((context) => service.getSavedListDetail(context, { listId })));
}

export async function renameSavedListAction(
  listId: string,
  name: string,
): Promise<SavedListResult> {
  return asList(call((context) => service.renameSavedList(context, { listId, name })));
}

export async function deleteSavedListAction(listId: string): Promise<SavedListDeleteResult> {
  const result = await call((context) => service.deleteSavedListById(context, { listId }));
  return result.ok ? { ok: true, id: result.data.id } : result;
}

export async function addSavedListItemAction(
  listId: string,
  item: NewSavedListItem,
): Promise<SavedListResult> {
  return asList(call((context) => service.addSavedListItem(context, { listId, ...item })));
}

export async function updateSavedListItemAction(
  listId: string,
  itemId: string,
  item: NewSavedListItem,
): Promise<SavedListResult> {
  return asList(
    call((context) => service.updateSavedListItem(context, { listId, itemId, ...item })),
  );
}

export async function removeSavedListItemAction(
  listId: string,
  itemId: string,
): Promise<SavedListResult> {
  return asList(call((context) => service.removeSavedListItem(context, { listId, itemId })));
}

/** What the screens use. Passed down from the server pages so the client code never imports the actions directly. */
export interface SavedListActions {
  list: typeof listSavedListsAction;
  get: typeof getSavedListAction;
  rename: typeof renameSavedListAction;
  remove: typeof deleteSavedListAction;
  addItem: typeof addSavedListItemAction;
  updateItem: typeof updateSavedListItemAction;
  removeItem: typeof removeSavedListItemAction;
}

import type { Metadata } from "next";
import { SavedListEditor } from "@/features/saved-lists/SavedListEditor";
import {
  addSavedListItemAction,
  getSavedListAction,
  removeSavedListItemAction,
  renameSavedListAction,
  updateSavedListItemAction,
} from "@/features/staples/saved-list-actions";

export const metadata: Metadata = { title: "Edit saved list" };

export default async function SavedListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SavedListEditor
      listId={id}
      actions={{
        get: getSavedListAction,
        rename: renameSavedListAction,
        addItem: addSavedListItemAction,
        updateItem: updateSavedListItemAction,
        removeItem: removeSavedListItemAction,
      }}
    />
  );
}

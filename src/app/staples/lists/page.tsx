import type { Metadata } from "next";
import { SavedListsScreen } from "@/features/saved-lists/SavedListsScreen";
import {
  deleteSavedListAction,
  listSavedListsAction,
  renameSavedListAction,
} from "@/features/staples/saved-list-actions";

export const metadata: Metadata = { title: "Saved lists" };

export default function SavedListsPage() {
  return (
    <SavedListsScreen
      actions={{
        list: listSavedListsAction,
        rename: renameSavedListAction,
        remove: deleteSavedListAction,
      }}
    />
  );
}

import { Card } from "@/components/ui/Card";
import { groupByCategory, itemsLabel } from "@/features/saved-lists/saved-lists-view";
import type { SavedListDetail } from "@/server/data/service";

/**
 * The "Review your list" body when a trip starts from a saved list (#170, #140 spec §2): the list's items, grouped by
 * category and read-only, in place of the preferences card. The length-based counts and the live calculation do not
 * apply to a list trip, which the callout says.
 */
export function ListReview({ list }: { list: SavedListDetail }) {
  const groups = groupByCategory(list.items);
  return (
    <Card padded>
      <div className="callout">
        <strong>Preferences and the length-based counts aren’t used with a saved list.</strong> The
        trip starts with the {itemsLabel(list.items.length)} below, all unpacked.
      </div>
      <div className="review-group list-review">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`list-review-${group.category}`}>
            <h3 id={`list-review-${group.category}`}>{group.category}</h3>
            {group.rows.map((item) => (
              <div key={item.id} className="review-row">
                <div>
                  <strong>{item.name}</strong>
                </div>
                <span className="tag">{item.qty}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Card>
  );
}

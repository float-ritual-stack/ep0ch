import type {VirtualBranchPlacement} from "./types";

/** Plan against the full ranked membership, never the currently visible rows. */
export function placeOrderedItems(order: readonly string[], selectedIds: readonly string[], placement: VirtualBranchPlacement): string[] {
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 1000) {
    throw Error("Select between 1 and 1000 branch items");
  }
  const selected=new Set(selectedIds);
  if (selected.size!==selectedIds.length) throw Error("Selection contains duplicate block IDs");
  const members=new Set(order);
  if (selectedIds.some(id=>!members.has(id))) throw Error("Selection contains a block that is not a branch member");
  const moving=order.filter(id=>selected.has(id));
  const remaining=order.filter(id=>!selected.has(id));
  switch(placement.kind) {
    case "top": return [...moving,...remaining];
    case "bottom": return [...remaining,...moving];
    case "before":
    case "after": {
      const anchor=remaining.indexOf(placement.anchorId);
      if (anchor<0) throw Error("Placement anchor must be an unselected member of this branch");
      const at=anchor+Number(placement.kind==="after");
      return [...remaining.slice(0,at),...moving,...remaining.slice(at)];
    }
    case "up":
    case "down": {
      const result=[...order];
      // Scanning toward the move makes each selected run cross one unselected neighbor.
      if (placement.kind==="up") {
        for(let i=1;i<result.length;i++) if(selected.has(result[i]!)&&!selected.has(result[i-1]!)) {
          [result[i-1],result[i]]=[result[i]!,result[i-1]!];
        }
      } else {
        for(let i=result.length-2;i>=0;i--) if(selected.has(result[i]!)&&!selected.has(result[i+1]!)) {
          [result[i],result[i+1]]=[result[i+1]!,result[i]!];
        }
      }
      return result;
    }
    default: throw Error("Unknown branch placement");
  }
}

import type { DesignObject } from "@/lib/design";
import type { EditorAction, EditorState } from "./types";

/**
 * Pure editor reducer. Keeping every mutation here is what makes undo/redo
 * reliable: history is just an array of these states, with no hidden mutable
 * canvas state to fall out of sync.
 */

function nextZIndex(objects: DesignObject[]): number {
  return objects.reduce((max, o) => Math.max(max, o.zIndex), 0) + 1;
}

/** Re-packs zIndex values into 1..n so ordering stays stable and readable. */
function normalise(objects: DesignObject[]): DesignObject[] {
  return [...objects]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((o, i) => (o.zIndex === i + 1 ? o : { ...o, zIndex: i + 1 }));
}

export function newObjectId(): string {
  return `obj_${Math.random().toString(36).slice(2, 10)}`;
}

export function editorReducer(state: EditorState, action: EditorState | EditorAction): EditorState {
  if (!("type" in action)) return action; // history restore

  switch (action.type) {
    case "add-object": {
      const object = { ...action.object, zIndex: nextZIndex(state.design.objects) };
      return {
        ...state,
        design: { ...state.design, objects: normalise([...state.design.objects, object]) },
        selectedId: object.id,
      };
    }

    case "update-object": {
      const objects = state.design.objects.map((o) =>
        o.id === action.id ? ({ ...o, ...action.patch } as DesignObject) : o
      );
      return { ...state, design: { ...state.design, objects } };
    }

    case "remove-object": {
      const objects = normalise(state.design.objects.filter((o) => o.id !== action.id));
      return {
        ...state,
        design: { ...state.design, objects },
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }

    case "duplicate-object": {
      const source = state.design.objects.find((o) => o.id === action.id);
      if (!source) return state;
      // Offset slightly so the copy is visibly distinct from the original.
      const offset = Math.round(state.design.printArea.widthPx * 0.03);
      const copy: DesignObject = {
        ...source,
        id: newObjectId(),
        x: source.x + offset,
        y: source.y + offset,
        zIndex: nextZIndex(state.design.objects),
      };
      return {
        ...state,
        design: { ...state.design, objects: normalise([...state.design.objects, copy]) },
        selectedId: copy.id,
      };
    }

    case "select":
      return { ...state, selectedId: action.id };

    case "reorder": {
      const sorted = [...state.design.objects].sort((a, b) => a.zIndex - b.zIndex);
      const index = sorted.findIndex((o) => o.id === action.id);
      if (index === -1) return state;

      const [item] = sorted.splice(index, 1);
      const target =
        action.direction === "front"
          ? sorted.length
          : action.direction === "back"
            ? 0
            : action.direction === "forward"
              ? Math.min(index + 1, sorted.length)
              : Math.max(index - 1, 0);

      sorted.splice(target, 0, item);
      return {
        ...state,
        design: {
          ...state.design,
          objects: sorted.map((o, i) => ({ ...o, zIndex: i + 1 })),
        },
      };
    }

    case "set-color":
      return {
        ...state,
        design: { ...state.design, color: action.color, baseVariantId: action.variantId },
      };

    case "add-asset":
      return { ...state, assets: { ...state.assets, [action.asset.id]: action.asset } };

    case "update-asset": {
      const existing = state.assets[action.id];
      if (!existing) return state;
      return {
        ...state,
        assets: { ...state.assets, [action.id]: { ...existing, ...action.patch } },
      };
    }

    case "remove-asset": {
      const assets = { ...state.assets };
      delete assets[action.id];
      // Objects referencing a deleted asset must go too, or the design would
      // fail validation later with a dangling reference.
      const objects = normalise(
        state.design.objects.filter(
          (o) => o.type === "text" || o.assetId !== action.id
        )
      );
      return { ...state, assets, design: { ...state.design, objects } };
    }

    case "replace-design":
      return { ...state, design: action.design, selectedId: null };

    case "center": {
      const object = state.design.objects.find((o) => o.id === action.id);
      if (!object) return state;
      const patch =
        action.axis === "horizontal"
          ? { x: state.design.printArea.widthPx / 2 }
          : { y: state.design.printArea.heightPx / 2 };
      return editorReducer(state, { type: "update-object", id: action.id, patch });
    }

    default:
      return state;
  }
}

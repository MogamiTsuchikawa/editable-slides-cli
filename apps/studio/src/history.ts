import type { OverrideDocument } from "./overrides.js";

export interface EditHistory {
  past: OverrideDocument[];
  present: OverrideDocument;
  future: OverrideDocument[];
  gestureStart: OverrideDocument | null;
}

export type HistoryAction =
  | { type: "reset"; document: OverrideDocument }
  | { type: "begin" }
  | { type: "preview"; document: OverrideDocument }
  | { type: "commit" }
  | { type: "apply"; document: OverrideDocument }
  | { type: "undo" }
  | { type: "redo" };

export function createEditHistory(document: OverrideDocument): EditHistory {
  return {
    past: [],
    present: document,
    future: [],
    gestureStart: null,
  };
}

function sameDocument(left: OverrideDocument, right: OverrideDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function historyReducer(state: EditHistory, action: HistoryAction): EditHistory {
  switch (action.type) {
    case "reset":
      return createEditHistory(action.document);
    case "begin":
      return state.gestureStart ? state : { ...state, gestureStart: state.present };
    case "preview":
      return { ...state, present: action.document };
    case "commit": {
      const start = state.gestureStart;
      if (!start || sameDocument(start, state.present)) {
        return { ...state, gestureStart: null };
      }
      return {
        past: [...state.past, start],
        present: state.present,
        future: [],
        gestureStart: null,
      };
    }
    case "apply":
      if (sameDocument(state.present, action.document)) return state;
      return {
        past: [...state.past, state.present],
        present: action.document,
        future: [],
        gestureStart: null,
      };
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        gestureStart: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        gestureStart: null,
      };
    }
  }
}

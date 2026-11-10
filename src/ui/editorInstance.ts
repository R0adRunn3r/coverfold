import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createEditor, type EditorState } from '../core/store';

/** Single editor instance for the app (core logic, framework-agnostic). */
export const editor = createEditor();

// Development aid: lets automated checks drive the editor from the console.
if (import.meta.env.DEV) (window as unknown as { __coverfold: unknown }).__coverfold = { editor };

/** React binding: subscribe to a slice of the editor state. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editor.store, selector);
}

/** Same as useEditor for selectors that build a new array/object (compared shallowly). */
export function useEditorShallow<T>(selector: (s: EditorState) => T): T {
  return useStore(editor.store, useShallow(selector));
}

export const EMPTY: never[] = [];

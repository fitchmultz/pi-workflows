import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

// The personal fork of pi-coding-agent additionally exports an instruction-groups
// extension factory and namespace aliases. Official hosts never provide these;
// tests that need them skip themselves at runtime when the export is absent.
declare module "@earendil-works/pi-coding-agent" {
  export const instructionGroupsExtension: ExtensionFactory | undefined;
  export interface ToolNamespace {
    /** Fork-only: additional callable names for a namespace's tools. */
    aliases?: string[];
  }
}

// CSS parsing — Spec Section 9.4 (inputs) using postcss.
// Builds a CssFileModel: rules (selector, declarations, source order) and
// :root custom properties collected into rootVars.

import postcss from "postcss";
import type { CssDeclarationNode, CssFileModel, CssRuleNode } from "./model.js";

export interface CssParseResult {
  model: CssFileModel;
  parseError?: { message: string };
}

function splitSelectorList(selector: string): string[] {
  // Top-level comma split (selectors never contain commas inside our
  // supported grammar — no :is()/:not() argument lists to worry about).
  return selector.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseCssFile(filePath: string, source: string): CssParseResult {
  let root: postcss.Root;
  try {
    root = postcss.parse(source, { from: filePath });
  } catch (cause) {
    return {
      model: { path: filePath, sha256: "", rules: [], rootVars: {} },
      parseError: { message: cause instanceof Error ? cause.message : String(cause) },
    };
  }

  const rules: CssRuleNode[] = [];
  const rootVars: Record<string, string> = {};
  let sourceOrder = 0;

  function declarationsOf(ruleNode: postcss.Rule): CssDeclarationNode[] {
    const decls: CssDeclarationNode[] = [];
    ruleNode.walkDecls((decl) => {
      decls.push({
        property: decl.prop,
        value: decl.value,
        important: decl.important === true,
        line: decl.source?.start?.line ?? ruleNode.source?.start?.line ?? 0,
        column: decl.source?.start?.column ?? 0,
      });
    });
    return decls;
  }

  function handleRule(ruleNode: postcss.Rule, unsupportedAtRule: string | undefined): void {
    const declarations = declarationsOf(ruleNode);
    for (const singleSelector of splitSelectorList(ruleNode.selector)) {
      rules.push({
        selector: singleSelector,
        declarations,
        line: ruleNode.source?.start?.line ?? 0,
        sourceOrder: sourceOrder++,
        ...(unsupportedAtRule ? { unsupportedAtRule } : {}),
      });
      if (singleSelector === ":root" && !unsupportedAtRule) {
        for (const decl of declarations) {
          if (decl.property.startsWith("--")) {
            rootVars[decl.property] = decl.value;
          }
        }
      }
    }
  }

  root.each((node) => {
    if (node.type === "rule") {
      handleRule(node as postcss.Rule, undefined);
    } else if (node.type === "atrule") {
      const atRule = node as postcss.AtRule;
      atRule.each((inner) => {
        if (inner.type === "rule") {
          handleRule(inner as postcss.Rule, atRule.name);
        }
      });
    }
  });

  return { model: { path: filePath, sha256: "", rules, rootVars } };
}

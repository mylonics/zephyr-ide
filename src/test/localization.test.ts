import * as assert from "assert";
import * as fs from "fs";
import * as ts from "typescript";
import * as path from "path";

suite("Localization catalogs", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const english: Record<string, string> = read("package.nls.json");
  const chinese: Record<string, string> = read("package.nls.zh-cn.json");

  test("every manifest message resolves in English and Simplified Chinese", () => {
    const manifest = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const keys = Array.from(manifest.matchAll(/"%([^%"\n]+)%"/g), match => match[1]);
    assert.ok(keys.length > 0);
    assert.deepStrictEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
    for (const key of keys) {
      assert.ok(english[key]?.trim(), key);
      assert.ok(chinese[key]?.trim(), key);
    }
  });

  test("the welcome view links to the same actions in both languages", () => {
    const links = (message: string) => Array.from(message.matchAll(/\]\(([^)]+)\)/g), match => match[1]);
    assert.deepStrictEqual(links(chinese["welcome.contents"]), links(english["welcome.contents"]));
  });

  test("literal runtime messages have a Simplified Chinese translation", () => {
    const messages = read("l10n/bundle.l10n.zh-cn.json");
    const missing = new Set<string>();
    const files = ts.sys.readDirectory(path.join(root, "src"), [".ts"], ["**/test/**"]);
    for (const file of files) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const panelFunctions = new Set(["panelText"]);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) { continue; }
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) { continue; }
        for (const item of bindings.elements) {
          if (item.propertyName?.text === "panelText") { panelFunctions.add(item.name.text); }
        }
      }
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText(source);
          const arg = node.arguments[0];
          if ((panelFunctions.has(name) || /(?:^|\.)l10n\.t$/.test(name)) &&
              arg && ts.isStringLiteralLike(arg) && !messages[arg.text]) {
            missing.add(arg.text);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    assert.deepStrictEqual([...missing].sort(), []);
  });

  test("runtime translations reference only arguments supplied by the source message", () => {
    const messages: Record<string, string> = read("l10n/bundle.l10n.zh-cn.json");
    for (const [source, translation] of Object.entries(messages)) {
      assert.ok(translation.trim(), source);
      for (const placeholder of translation.match(/\{\d+\}/g) ?? []) {
        assert.ok(source.includes(placeholder), source + " " + placeholder);
      }
    }
  });
});

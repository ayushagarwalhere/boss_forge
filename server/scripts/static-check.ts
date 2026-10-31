import ts from 'typescript';

const factories = new Set(['emit', 'moveTo', 'wait', 'say', 'telegraph', 'rand']);
const maths = new Set(['abs', 'min', 'max', 'floor', 'ceil', 'round', 'sin', 'cos', 'PI']);
const forbidden = new Set(['Date', 'Promise', 'Function', 'eval', 'process', 'require', 'fetch', 'WebAssembly', 'globalThis', 'window', 'document', 'constructor', 'prototype', '__proto__', 'random']);
const allowed = new Set([
  'SourceFile', 'EndOfFileToken', 'FunctionDeclaration', 'ExportKeyword', 'AsteriskToken', 'Identifier', 'Parameter', 'Block',
  'VariableStatement', 'VariableDeclarationList', 'VariableDeclaration', 'NumericLiteral', 'StringLiteral', 'TrueKeyword', 'FalseKeyword',
  'ObjectLiteralExpression', 'PropertyAssignment', 'ArrayLiteralExpression', 'ExpressionStatement', 'CallExpression', 'PropertyAccessExpression',
  'YieldExpression', 'ForStatement', 'WhileStatement', 'IfStatement', 'ReturnStatement', 'BreakStatement', 'EmptyStatement',
  'BinaryExpression', 'PrefixUnaryExpression', 'PostfixUnaryExpression', 'ParenthesizedExpression', 'ConditionalExpression',
  'EqualsToken', 'PlusToken', 'MinusToken', 'PlusPlusToken', 'MinusMinusToken', 'PlusEqualsToken', 'MinusEqualsToken',
  'AsteriskEqualsToken', 'SlashToken', 'PercentToken', 'LessThanToken', 'GreaterThanToken', 'LessThanEqualsToken', 'GreaterThanEqualsToken',
  'EqualsEqualsEqualsToken', 'ExclamationEqualsEqualsToken', 'AmpersandAmpersandToken', 'BarBarToken', 'QuestionToken', 'ColonToken',
].map((name) => ts.SyntaxKind[name as keyof typeof ts.SyntaxKind]));
/** Conservative JavaScript subset in a .ts file; the interpreter is a second, independent boundary. */
export function checkScript(source: string) {
  if (Buffer.byteLength(source) > 16384) throw new Error('boss.ts exceeds 16 KiB.');
  const file = ts.createSourceFile('boss.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const script = file.statements[0];
  if (file.statements.length !== 1 || !script || !ts.isFunctionDeclaration(script) || script.name?.text !== 'script' || !script.asteriskToken || script.parameters.length !== 1 || script.parameters[0]?.name.getText(file) !== 'api' || script.parameters[0]?.type || script.type || !script.body || script.modifiers?.some((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword)) throw new Error('Use only export function* script(api) { ... }, without imports or type annotations.');
  let nodes = 0;
  const visit = (node: ts.Node, depth = 0) => {
    if (++nodes > 2000 || depth > 64 || !allowed.has(node.kind)) throw new Error(`Unsupported or oversized script syntax: ${ts.SyntaxKind[node.kind]}.`);
    if (ts.isFunctionDeclaration(node) && node !== script) throw new Error('Nested functions are forbidden.');
    if (ts.isIdentifier(node) && (forbidden.has(node.text) || node.text.startsWith('_'))) throw new Error('Forbidden script name.');
    if (ts.isYieldExpression(node) && node.asteriskToken) throw new Error('yield* is forbidden.');
    if (ts.isReturnStatement(node) && node.expression) throw new Error('Script must return void.');
    if (ts.isPropertyAccessExpression(node)) {
      const owner = node.expression.getText(file), name = node.name.text;
      if (!(owner === 'api' && factories.has(name)) && !(owner === 'Math' && maths.has(name))) throw new Error('Only api factories and deterministic Math members are available.');
    }
    if (ts.isCallExpression(node) && (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text === 'PI')) throw new Error('Only command factories and deterministic Math calls are allowed.');
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && !ts.isIdentifier(node.left)) throw new Error('Only local variables may be assigned.');
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  visit(file);
  const result = ts.transpileModule(source.replace(/^\s*export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (result.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) throw new Error('Invalid boss.ts syntax.');
  return result.outputText;
}

/**
 * t2 — code index (brief §5.1). ts-morph over the cloned target repo.
 *
 * Outputs, both keyed by repo-relative path so they line up with whatever a ticket names:
 *   data/symbols.json  symbol → { file, exported }      (SymbolIndex)
 *   data/imports.json  file   → [files it imports]      (ImportGraph)
 *
 * Agent 2's dependency_break check is `removes` ∩ (symbols reachable from A's files), so the
 * index has to answer "where does this symbol live" and "who imports that file" fast. Both
 * are plain objects on disk — no ts-morph at agent runtime.
 */
import { Project, Node, type SourceFile } from 'ts-morph';
import type { ImportGraph, SymbolIndex, SymbolEntry } from '../types.js';
import path from 'node:path';

export interface IndexResult {
  symbols: SymbolIndex;
  imports: ImportGraph;
  /** Same-named symbols in different files. The contract is one entry per name, so we keep
   *  the exported one and surface the rest here rather than silently dropping them. */
  collisions: Record<string, SymbolEntry[]>;
  stats: { files: number; symbols: number; exported: number; edges: number; collisions: number };
}

const isTest = (p: string) => /\.(test|spec)\.tsx?$/.test(p) || /[\/](__tests__|test|tests)[\/]/.test(p);

/** Declarations worth indexing: the things a ticket can say it removes or changes. */
function declaredNames(sf: SourceFile): { name: string; exported: boolean }[] {
  const out: { name: string; exported: boolean }[] = [];
  for (const stmt of sf.getStatements()) {
    if (Node.isVariableStatement(stmt)) {
      const exported = stmt.isExported();
      for (const d of stmt.getDeclarations()) out.push({ name: d.getName(), exported });
    } else if (
      Node.isFunctionDeclaration(stmt) ||
      Node.isClassDeclaration(stmt) ||
      Node.isInterfaceDeclaration(stmt) ||
      Node.isTypeAliasDeclaration(stmt) ||
      Node.isEnumDeclaration(stmt)
    ) {
      const name = stmt.getName();
      if (name) out.push({ name, exported: stmt.isExported() });
    }
  }
  return out;
}

export function buildIndex(repoRoot: string, globs: string[]): IndexResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  });
  project.addSourceFilesAtPaths(globs);

  const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join('/');

  const symbols: SymbolIndex = {};
  const collisions: Record<string, SymbolEntry[]> = {};
  const imports: ImportGraph = {};
  let files = 0;
  let edges = 0;

  const sourceFiles = project.getSourceFiles().filter((sf) => !isTest(sf.getFilePath()));
  const known = new Set(sourceFiles.map((sf) => rel(sf.getFilePath())));

  for (const sf of sourceFiles) {
    files++;
    const file = rel(sf.getFilePath());

    for (const { name, exported } of declaredNames(sf)) {
      const entry: SymbolEntry = { file, exported };
      const existing = symbols[name];
      if (!existing) {
        symbols[name] = entry;
      } else {
        // Exported wins — that is the one another file can actually depend on.
        (collisions[name] ??= [existing]).push(entry);
        if (!existing.exported && exported) symbols[name] = entry;
      }
    }

    // Only internal edges: an import of `hono/jsx` from outside the repo tells us nothing
    // about which tickets collide.
    const targets = new Set<string>();
    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const spec = decl.getModuleSpecifierValue();
      if (!spec || !spec.startsWith('.')) continue;
      const resolved = resolveInternal(file, spec, known);
      if (resolved) targets.add(resolved);
    }
    imports[file] = [...targets].sort();
    edges += targets.size;
  }

  const exported = Object.values(symbols).filter((s) => s.exported).length;
  return {
    symbols,
    imports,
    collisions,
    stats: { files, symbols: Object.keys(symbols).length, exported, edges, collisions: Object.keys(collisions).length },
  };
}

/** Relative specifiers in a TS repo are extensionless, or carry a .js that means .ts. */
function resolveInternal(fromFile: string, spec: string, known: Set<string>): string | undefined {
  // normalize keeps a trailing slash for `./` and `../`, which are directory imports.
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)).replace(/\/$/, '');
  const stripped = base.replace(/\.js$/, '');
  const candidates = [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}/index.ts`, `${stripped}/index.tsx`];
  return candidates.find((c) => known.has(c));
}

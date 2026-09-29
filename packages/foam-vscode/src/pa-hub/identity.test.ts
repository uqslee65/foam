import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const testDirectory = __dirname;
const sourceDirectory = path.resolve(testDirectory, '..');
const packageDirectory = path.resolve(sourceDirectory, '..');
const repositoryDirectory = path.resolve(packageDirectory, '../..');
const manifestPath = path.join(packageDirectory, 'package.json');
const grammarPath = path.join(packageDirectory, 'syntaxes', 'injection.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
  string,
  any
>;
const contributes = manifest.contributes as Record<string, any>;

const namespaceAllowlist = [
  {
    file: 'src/vscode/services/telemetry.ts',
    needle: 'foam.',
    why: 'Telemetry common-dimension names are stable analytics fields, not VS Code identifiers.',
  },
  {
    file: 'src/vscode/features/preview/foam-query-renderer.test.ts',
    needle: 'foam.',
    why: 'Embedded Foam query examples use the core scripting namespace, not the extension namespace.',
  },
  {
    file: 'src/test/pa-hub/isolation-config.ts',
    needle: 'foam.foam-vscode',
    why: 'Coexistence profile references the marketplace Foam extension ID for side-by-side testing.',
  },
] as const;

function readSource(file: string): string {
  return readFileSync(path.join(packageDirectory, file), 'utf8');
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const fullPath = path.join(directory, entry);
    if (['node_modules', 'out', 'dist'].includes(entry)) {
      return [];
    }
    return statSync(fullPath).isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function collectMenuFields(
  value: unknown
): Array<{ field: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap(item => collectMenuFields(item));
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    if (
      ['command', 'when', 'submenu'].includes(key) &&
      typeof child === 'string'
    ) {
      return [{ field: key, value: child }];
    }
    return collectMenuFields(child);
  });
}

describe('test_identity_manifest', () => {
  it('test_identity_publisher_name_displayname', () => {
    expect(manifest.publisher).toBe('lazarus');
    expect(manifest.name).toBe('pa-hub');
    expect(manifest.displayName).toBe('PA Hub');
    expect(`${manifest.publisher}.${manifest.name}`).toBe('lazarus.pa-hub');
  });

  it('test_identity_no_marketplace_metadata', () => {
    expect('__metadata' in manifest).toBe(false);
  });

  it('test_identity_commands_prefixed', () => {
    const commands = contributes.commands as Array<Record<string, string>>;
    expect(commands).toHaveLength(60);
    expect(
      commands.every(command => command.command.startsWith('pa-hub.'))
    ).toBe(true);
    expect(commands.every(command => command.category === 'PA Hub')).toBe(true);
  });

  it('test_identity_configuration_prefixed', () => {
    const properties = Object.keys(contributes.configuration.properties);
    expect(properties).toHaveLength(34);
    expect(properties.every(key => key.startsWith('pa-hub.'))).toBe(true);
    expect(properties.some(key => key.includes('foam'))).toBe(false);
  });

  it('test_identity_views_menus_keybindings_colors', () => {
    const viewIds = Object.values(contributes.views as Record<string, any[]>)
      .flat()
      .map(view => view.id);
    const welcomeViews = contributes.viewsWelcome.map(
      (view: Record<string, string>) => view.view
    );
    const keybindingCommands = (contributes.keybindings ?? []).map(
      (binding: Record<string, string>) => binding.command
    );
    const colorIds = contributes.colors.map(
      (color: Record<string, string>) => color.id
    );
    const menuFields = collectMenuFields(contributes.menus);
    const welcomeCommandReferences = contributes.viewsWelcome.flatMap(
      (view: Record<string, string>) =>
        [...view.contents.matchAll(/\(command:([^)]+)/g)].map(match => match[1])
    );
    const allFields = [
      ...viewIds,
      ...welcomeViews,
      ...keybindingCommands,
      ...colorIds,
      ...menuFields.map(entry => entry.value),
      ...welcomeCommandReferences,
    ];

    expect(allFields.every(value => !/foam-vscode\.|foam\./.test(value))).toBe(
      true
    );
    expect(
      [
        ...keybindingCommands,
        ...menuFields
          .filter(
            entry => entry.field === 'command' || entry.field === 'submenu'
          )
          .map(entry => entry.value),
      ].every(value => value.startsWith('pa-hub.'))
    ).toBe(true);
    expect(
      welcomeCommandReferences.every(command => command.startsWith('pa-hub.'))
    ).toBe(true);
  });

  it('test_identity_grammar_scope', () => {
    const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as Record<
      string,
      string
    >;
    expect(contributes.grammars[0].scopeName).toBe('pa-hub.wikilink.injection');
    expect(contributes.grammars[0].scopeName).toBe(grammar.scopeName);
  });

  it('test_identity_source_tree_free_of_foam_namespace', () => {
    const identityTestPath = path.resolve(testDirectory, 'identity.test.ts');
    const sourceLines = walkFiles(sourceDirectory)
      .filter(file => path.resolve(file) !== identityTestPath)
      .flatMap(file => {
        const relativeFile = path.relative(packageDirectory, file);
        return readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((line, index) => ({
            file: relativeFile,
            line,
            lineNumber: index + 1,
          }));
      });
    const oldCommandNamespace = /foam-vscode\./;
    const oldConfigNamespace = /['"`]foam\.[A-Za-z]/;
    const commandLeftovers = sourceLines.filter(({ line }) =>
      oldCommandNamespace.test(line)
    );
    const configLeftovers = sourceLines.filter(({ line }) =>
      oldConfigNamespace.test(line)
    );
    const unexpectedConfigLeftovers = configLeftovers.filter(
      ({ file, line }) =>
        !namespaceAllowlist.some(
          allowed => file === allowed.file && line.includes(allowed.needle)
        )
    );

    expect(commandLeftovers).toEqual([]);
    expect(unexpectedConfigLeftovers).toEqual([]);
    for (const allowed of namespaceAllowlist) {
      expect(
        configLeftovers.some(
          ({ file, line }) =>
            file === allowed.file && line.includes(allowed.needle)
        )
      ).toBe(true);
    }
  });

  it('test_identity_serializer_and_context_keys', () => {
    const graphText = readSource('src/vscode/features/graph-webview/index.ts');
    expect(
      graphText.match(/'pa-hub\.graph'/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(graphText).not.toContain("'foam-graph'");

    const contextSources = [
      readSource('src/vscode/utils/vsc-utils.ts'),
      readSource('src/vscode/features/notes/notes-explorer.ts'),
      readSource('src/vscode/features/ai/related-notes.ts'),
    ];
    const setContextKeys = contextSources.flatMap(text =>
      [
        ...text.matchAll(
          /executeCommand\(\s*['"]setContext['"]\s*,\s*(['"`])([^'"`]+)\1/g
        ),
      ].map(match => match[2])
    );
    expect(setContextKeys.length).toBeGreaterThan(0);
    expect(setContextKeys.every(key => key.startsWith('pa-hub.'))).toBe(true);
    expect(
      contextSources.every(text => !/['"`]foam\.[A-Za-z]/.test(text))
    ).toBe(true);
  });

  it('test_identity_root_workspace_scripts', () => {
    const rootManifest = JSON.parse(
      readFileSync(path.join(repositoryDirectory, 'package.json'), 'utf8')
    ) as Record<string, any>;
    expect(JSON.stringify(rootManifest.scripts)).not.toContain('foam-vscode');
    expect(rootManifest.scripts.package).toBe('yarn workspace pa-hub package');
  });

  it('test_identity_manifest_text_free_of_foam_namespace', () => {
    const identityManifest = Object.fromEntries(
      Object.entries(manifest).filter(
        ([key]) => key !== 'dependencies' && key !== 'devDependencies'
      )
    );
    const manifestText = JSON.stringify(identityManifest);
    expect(manifestText).not.toContain(['foam-vscode', '.'].join(''));
    expect(manifestText).not.toContain('"foam.');
    expect(manifestText).not.toContain('__metadata');
  });
});
